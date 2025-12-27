from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import httpx

from ..sim.agent import District, Issue


DEFAULT_ACS_VARS: List[str] = [
    "NAME",
    "B01001_001E",  # total population
    "B19013_001E",  # median household income
    "B17001_002E",  # poverty count
    "B17001_001E",  # poverty universe
]


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


async def fetch_acs5_congressional_districts(
    year: int,
    state_fips: Optional[str] = None,
    variables: Optional[List[str]] = None,
    timeout_s: float = 60.0,
) -> List[Dict[str, str]]:
    """Fetch ACS 5-year estimates at the congressional district geography.

    Uses the Census Data API. Example queries are documented by the Census API itself.
    """
    vars_ = variables or DEFAULT_ACS_VARS
    if "NAME" not in vars_:
        vars_ = ["NAME"] + vars_

    url = f"https://api.census.gov/data/{year}/acs/acs5"
    params = {
        "get": ",".join(vars_),
        "for": "congressional district:*",
    }
    if state_fips:
        params["in"] = f"state:{state_fips}"

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()

    if not data or len(data) < 2:
        return []

    header = data[0]
    rows = data[1:]

    out: List[Dict[str, str]] = []
    for row in rows:
        rec = {header[i]: row[i] for i in range(min(len(header), len(row)))}
        out.append(rec)
    return out


def acs_rows_to_districts(
    rows: List[Dict[str, str]],
    *,
    scenario: Optional[Dict[Issue, float]] = None,
) -> List[District]:
    """Convert ACS rows to District objects.

    `scenario` defines default issue-salience weights if the row doesn't provide any.
    """
    scenario = scenario or {
        "economy": 0.30,
        "climate": 0.18,
        "healthcare": 0.22,
        "immigration": 0.15,
        "education": 0.15,
    }

    districts: List[District] = []
    for rec in rows:
        state_fips = rec.get("state")
        cd = rec.get("congressional district")
        name = rec.get("NAME") or f"State {state_fips} CD {cd}"
        pop = int(float(rec.get("B01001_001E", "0") or 0))
        med_income = float(rec.get("B19013_001E", "0") or 0)
        pov_universe = float(rec.get("B17001_001E", "0") or 0)
        pov_count = float(rec.get("B17001_002E", "0") or 0)

        poverty_rate = (pov_count / pov_universe) if pov_universe > 0 else 0.0

        # Lightweight, transparent derived features.
        demographics = {
            "median_income": med_income,
            "poverty_rate": poverty_rate,
        }

        # Conservative-ish defaults: keep weights stable and explainable.
        # You can plug in better mappings later.
        weights: Dict[Issue, float] = dict(scenario)

        # Small tweaks based on poverty/income so that different districts do differ.
        if med_income > 0:
            income_norm = min(1.0, med_income / 100000.0)  # ~0..1
            weights["economy"] = _clamp(weights["economy"] + 0.10 * (1 - income_norm), 0.05, 0.60)
            weights["education"] = _clamp(weights["education"] + 0.05 * income_norm, 0.05, 0.50)
        weights["healthcare"] = _clamp(weights["healthcare"] + 0.08 * poverty_rate, 0.05, 0.60)

        # Normalize to sum to 1.
        s = sum(weights.values()) or 1.0
        weights = {k: float(v) / s for k, v in weights.items()}

        district_id = f"{state_fips}-{cd}"
        # Heuristic Lean: Deterministic random based on ID to ensure agents have opinions.
        # (Real election data loading is a future step, this prevents mass abstention)
        import random
        rng = random.Random(district_id)
        lean = _clamp(rng.uniform(-0.8, 0.8))

        districts.append(
            District(
                district_id=district_id,
                name=name,
                state_fips=state_fips,
                cd=cd,
                lean=lean,
                population=pop,
                demographics=demographics,
                weights=weights,
            )
        )

    # Sort by district_id for stable output.
    districts.sort(key=lambda d: d.district_id)
    return districts
