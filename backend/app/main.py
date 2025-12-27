from __future__ import annotations
import os
from dotenv import load_dotenv

load_dotenv()
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    SimRequest,
    SimResponse,
    DistrictSummary,
    LoadAcsRequest,
    MakeSyntheticRequest,
    LoadElectionCsvUrlRequest,
    CongressGovIngestRequest,
    Bill,
)
from .state import (
    get_active_districts,
    get_active_summary,
    set_active_districts,
    load_mock_districts,
)
from .sim.engine import run_simulation
from .data_pipeline.census_acs import fetch_acs5_congressional_districts, acs_rows_to_districts
from .data_pipeline.synthetic import split_districts
from .data_pipeline.congressgov import (
    fetch_bill_json, 
    bill_json_to_bill_obj, 
    fetch_random_bill,
    fetch_recent_bills,
    fetch_bill_summaries
)
from .data_pipeline.elections import parse_house_csv_two_party, apply_lean

APP_ORIGIN = os.getenv("APP_ORIGIN", "http://localhost:5173")

# Allow multiple origins for local dev (5173, 5174, etc)
ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:8000",
]

app = FastAPI(title="Congress Simulation MVP", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}


@app.get("/districts/summary", response_model=DistrictSummary)
def districts_summary():
    return get_active_summary()


@app.post("/districts/use_mock", response_model=DistrictSummary)
def districts_use_mock():
    set_active_districts(load_mock_districts(), source="mock", meta={})
    return get_active_summary()


@app.post("/districts/load_acs", response_model=DistrictSummary)
async def districts_load_acs(req: LoadAcsRequest):
    try:
        rows = await fetch_acs5_congressional_districts(
            year=req.year,
            state_fips=req.state_fips,
            variables=req.variables,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch ACS data: {e}")

    districts = acs_rows_to_districts(rows)
    if not districts:
        raise HTTPException(status_code=404, detail="No districts returned by ACS query (check year/state_fips).")

    # High-Resolution: Split "Real" districts into sub-districts if requested
    if req.multiplier > 1:
        districts = split_districts(districts, req.multiplier, req.jitter)

    set_active_districts(
        districts,
        source="acs",
        meta={
            "year": req.year, 
            "state_fips": req.state_fips, 
            "variables": req.variables,
            "multiplier": req.multiplier,
            "jitter": req.jitter
        },
    )
    return get_active_summary()


@app.post("/districts/make_synthetic", response_model=DistrictSummary)
def districts_make_synthetic(req: MakeSyntheticRequest):
    base = get_active_districts()
    synthetic = split_districts(base, multiplier=req.multiplier, jitter=req.jitter, seed=req.seed)
    set_active_districts(
        synthetic,
        source="synthetic",
        meta={"multiplier": req.multiplier, "jitter": req.jitter, "seed": req.seed, "base_count": len(base)},
    )
    return get_active_summary()


@app.post("/elections/load_csv_url", response_model=DistrictSummary)
async def elections_load_csv_url(req: LoadElectionCsvUrlRequest):
    """Apply a district lean value from a CSV of two-party vote totals.

    Expected columns (configurable):
      - state FIPS (e.g., '32')
      - district (e.g., '1', '2', ...)
      - dem_votes / rep_votes

    This updates the *current* active districts in-place by replacing their `lean`.
    """
    base = get_active_districts()
    if not base:
        raise HTTPException(status_code=400, detail="No active districts loaded.")

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(req.url)
            resp.raise_for_status()
            csv_text = resp.text
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to download CSV: {e}")

    try:
        lean_map = parse_house_csv_two_party(
            csv_text,
            state_fips_col=req.state_fips_col,
            cd_col=req.cd_col,
            dem_votes_col=req.dem_votes_col,
            rep_votes_col=req.rep_votes_col,
            delimiter=req.delimiter,
        )
        updated = apply_lean(base, lean_map, strength=req.strength)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse/apply election CSV: {e}")

    summary = get_active_summary()
    meta = dict(summary.get("meta", {}))
    meta["election_lean"] = {
        "url": req.url,
        "strength": req.strength,
        "state_fips_col": req.state_fips_col,
        "cd_col": req.cd_col,
        "dem_votes_col": req.dem_votes_col,
        "rep_votes_col": req.rep_votes_col,
    }
    set_active_districts(updated, source=summary.get("source", "unknown"), meta=meta)
    return get_active_summary()


@app.post("/bills/congressgov/ingest", response_model=Bill)
async def ingest_bill(req: CongressGovIngestRequest):
    api_key = os.getenv("CONGRESS_GOV_API_KEY") or os.getenv("CONGRESS_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing CONGRESS_GOV_API_KEY (free key). "
                "Set it in your environment to use Congress.gov ingest."
            ),
        )

    base = os.getenv("CONGRESS_API_BASE", "https://api.congress.gov/v3")
    try:
        raw = await fetch_bill_json(
            congress=req.congress,
            bill_type=req.bill_type,
            bill_number=req.bill_number,
            api_key=api_key,
            base_url=base,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Congress.gov API error: {e}")
    return bill_json_to_bill_obj(raw)

@app.get("/bills/random", response_model=Bill)
async def get_random_bill():
    api_key = os.getenv("CONGRESS_GOV_API_KEY") or os.getenv("CONGRESS_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Missing CONGRESS_GOV_API_KEY. Cannot fetch random bills.",
        )
    
    base = os.getenv("CONGRESS_API_BASE", "https://api.congress.gov/v3")
    try:
        return await fetch_random_bill(api_key=api_key, base_url=base)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch random bill: {e}")
    


@app.get("/congress/recent")
async def get_recent_bills(limit: int = 20, offset: int = 0):
    api_key = os.getenv("CONGRESS_GOV_API_KEY") or os.getenv("CONGRESS_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Server missing CONGRESS_GOV_API_KEY."
        )
    
    base = os.getenv("CONGRESS_API_BASE", "https://api.congress.gov/v3")
    try:
        return await fetch_recent_bills(api_key=api_key, limit=limit, offset=offset, base_url=base)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Congress API error: {str(e)}")


@app.get("/congress/bill/{congress}/{bill_type}/{bill_number}")
async def get_bill_detail(congress: int, bill_type: str, bill_number: str):
    api_key = os.getenv("CONGRESS_GOV_API_KEY") or os.getenv("CONGRESS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Server missing API Key")
        
    base = os.getenv("CONGRESS_API_BASE", "https://api.congress.gov/v3")
    try:
        return await fetch_bill_json(
            congress=congress,
            bill_type=bill_type,
            bill_number=bill_number,
            api_key=api_key,
            base_url=base
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Bill not found or API error: {str(e)}")


@app.get("/congress/bill/{congress}/{bill_type}/{bill_number}/summaries")
async def get_bill_summaries(congress: int, bill_type: str, bill_number: str):
    api_key = os.getenv("CONGRESS_GOV_API_KEY") or os.getenv("CONGRESS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Server missing API Key")
        
    base = os.getenv("CONGRESS_API_BASE", "https://api.congress.gov/v3")
    try:
        return {"summaries": await fetch_bill_summaries(
            congress=congress,
            bill_type=bill_type,
            bill_number=bill_number,
            api_key=api_key,
            base_url=base
        )}
    except Exception as e:
        return {"summaries": []}


@app.post("/simulate", response_model=SimResponse)
async def simulate(req: SimRequest):
    districts = get_active_districts()
    out = await run_simulation(
        districts=districts,
        num_members=req.num_members,
        rounds=req.rounds,
        issue_vector=req.bill.issue_vector,
        use_llm=req.use_llm,
        llm_model=req.llm_model,
        seed=req.seed,
    )

    notes = []
    if req.use_llm:
        notes.append("Debate text: generated via local Ollama if available; otherwise fallback templates.")
    else:
        notes.append("Debate text: template fallback (no AI calls).")
    notes.append("Votes: deterministic utility model (transparent).")

    return SimResponse(
        members=out["members"],
        bill=req.bill,
        rounds=out["rounds"],
        final_passed=out["final_passed"],
        notes=notes,
    )
