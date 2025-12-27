from __future__ import annotations

import json
import os
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from .sim.agent import District, Issue


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def load_mock_districts() -> List[District]:
    base_dir = os.path.dirname(__file__)
    path = os.path.join(base_dir, "data", "mock_districts.json")
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    out: List[District] = []
    for d in raw:
        out.append(
            District(
                district_id=d["district_id"],
                name=d.get("name", d["district_id"]),
                state_fips=d.get("state_fips"),
                cd=str(d.get("cd")) if d.get("cd") is not None else None,
                lean=float(d.get("lean", 0.0)),
                population=int(d.get("population", 0)),
                demographics={k: float(v) for k, v in d.get("demographics", {}).items()},
                weights={k: float(v) for k, v in d.get("weights", {}).items()},
            )
        )
    return out


# --- In-memory "active" configuration ---

ACTIVE_SOURCE: str = "mock"  # 'mock' | 'acs' | 'synthetic'
ACTIVE_META: Dict[str, Any] = {}
ACTIVE_DISTRICTS: List[District] = load_mock_districts()


def set_active_districts(districts: List[District], source: str, meta: Optional[Dict[str, Any]] = None) -> None:
    global ACTIVE_SOURCE, ACTIVE_META, ACTIVE_DISTRICTS
    ACTIVE_SOURCE = source
    ACTIVE_META = meta or {}
    ACTIVE_DISTRICTS = districts


def get_active_districts() -> List[District]:
    return list(ACTIVE_DISTRICTS)


def get_active_summary(limit: Optional[int] = None) -> Dict[str, Any]:
    ds = get_active_districts()
    items = ds[:limit] if limit else ds
    
    # Serialize fully so the frontend can use them for simulation
    sample = [
        {
            "district_id": d.district_id,
            "name": d.name,
            "state_fips": d.state_fips,
            "cd": d.cd,
            "population": d.population,
            "lean": d.lean,
            "weights": dict(d.weights),
            "demographics": dict(d.demographics),
        }
        for d in items
    ]
    return {
        "source": ACTIVE_SOURCE,
        "meta": ACTIVE_META,
        "count": len(ds),  # Total count
        "sample": sample,  # Can be full list now
    }


def serialize_districts(ds: List[District]) -> List[Dict[str, Any]]:
    # For debugging / UI preview.
    return [
        {
            "district_id": d.district_id,
            "name": d.name,
            "state_fips": d.state_fips,
            "cd": d.cd,
            "lean": d.lean,
            "population": d.population,
            "demographics": dict(d.demographics),
            "weights": dict(d.weights),
        }
        for d in ds
    ]
