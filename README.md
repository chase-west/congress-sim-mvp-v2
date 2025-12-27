# Congress Simulation MVP (no paid APIs)

This is a **starter** full‑stack web app that simulates a Congress-like chamber with many agents.
It is designed to run with **$0 API spend** by default.

- **Frontend:** React + Vite
- **Backend:** FastAPI (Python)
- **AI (optional):** Local Ollama (no key). If Ollama isn't running, the app falls back to a template-based debater.

> Important: "Exact real-life congresspeople based on constituents" is not achievable in a literal sense.
> This MVP gives you the plumbing and a transparent modeling approach you can iteratively improve.

## Quickstart

### 1) Backend
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2) Frontend
```bash
cd frontend
npm install
npm run dev
```

Open the site: http://localhost:5173

## Optional: local AI via Ollama (still $0)
Install Ollama and run a model (example):
```bash
ollama serve
ollama pull llama3.1:8b
```

Then toggle **"Use local AI (Ollama)"** in the UI.

Ollama must be reachable at `http://localhost:11434`.

## What the simulation does (MVP)

- Creates N members (default 200; set up to 1000) by sampling from synthetic districts.
- Each member has:
  - district lean (-1..+1)
  - ideology (-1..+1)
  - issue weights (economy, climate, healthcare, immigration, education)
- Bills are represented as a simple **issue vector** (direction + magnitude per issue).
- Voting is **deterministic utility** (transparent), not "LLM vibes":
  - utility = sum_i weight_i * bill_i * ideology + district_lean_bias
- "Debate" text is generated either by:
  - local AI (Ollama) for a handful of spokespeople, or
  - a template fallback.

This makes the *decision-making* explainable while letting you have "AI debate" in a compute-friendly way.

## Where to plug in real data

- `backend/app/data/mock_districts.json` is synthetic.
- Replace it with real congressional district data (demographics, election returns, etc.).
- Add a pipeline in `backend/app/data_pipeline/` that fetches:
  - ACS district-level demographics (Census API)
  - roll-call / ideology reference data (Voteview)
  - bills (Congress.gov API) or other sources

## Added in v2+: real districts + synthetic scaling + Congress.gov ingest

The backend now supports:

- **Load district-level demographics from the Census ACS5 API** (free)
  - Endpoint: `POST /districts/load_acs` with `{ year, state_fips, variables }`
  - Uses congressional district geography (`for=congressional district:*&in=state:XX`).

- **Generate a synthetic chamber dynamically** by splitting districts
  - Endpoint: `POST /districts/make_synthetic` with `{ multiplier, jitter, seed }`
  - This is how you can get “~1000 members” while still anchoring to real districts.

- **Ingest a real bill from Congress.gov (v3 API)** (free key)
  - Endpoint: `POST /bills/congressgov/ingest` with `{ congress, bill_type, bill_number }`
  - Requires env var `CONGRESS_GOV_API_KEY` (free from data.gov).

### Environment vars

Backend:

```bash
APP_ORIGIN=http://localhost:5173

# Congress.gov v3 API (free key)
CONGRESS_GOV_API_KEY=...

# Optional override (some docs use api.data.gov/congress/v3)
CONGRESS_API_BASE=https://api.congress.gov/v3
```

### Optional: Apply election returns to set district lean (free CSV)

If you have a CSV (public URL) with **two-party vote totals** by district, you can apply it to the *currently-loaded* districts:

```bash
curl -s -X POST "http://localhost:8000/elections/load_csv_url" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/house_returns.csv",
    "state_fips_col": "state_fips",
    "cd_col": "district",
    "dem_votes_col": "dem_votes",
    "rep_votes_col": "rep_votes",
    "delimiter": ",",
    "strength": 1.0
  }'
```

This converts vote totals into a lean score in [-1, +1] and replaces each district's `lean` (used to sample member ideology).

## License
MIT
