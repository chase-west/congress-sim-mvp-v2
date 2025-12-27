from __future__ import annotations

from typing import Dict, List, Optional
import random

from ..sim.agent import District, Issue


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def split_districts(
    base: List[District],
    multiplier: int,
    jitter: float,
    seed: Optional[int] = None,
) -> List[District]:
    """Create a synthetic chamber by splitting each base district into N sub-districts.

    - `multiplier`: how many sub-districts per base district (e.g., 2 => ~2x seats).
    - `jitter`: how much to perturb lean / weights (0..1). Recommended 0.05..0.25.

    The population is divided evenly (integer floor) across sub-districts.
    """
    if multiplier <= 1:
        return list(base)

    rng = random.Random(seed)
    out: List[District] = []

    for d in base:
        sub_pop = max(1, int(d.population / multiplier)) if d.population else 0
        for i in range(multiplier):
            # Jitter lean a bit to create intra-district diversity.
            lean = _clamp(d.lean + rng.gauss(0.0, jitter * 0.35))

            # Jitter issue weights then renormalize.
            w: Dict[Issue, float] = {}
            for iss, val in d.weights.items():
                w[iss] = max(0.01, float(val) + rng.gauss(0.0, jitter * 0.08))
            s = sum(w.values()) or 1.0
            w = {k: v / s for k, v in w.items()}

            # Demographics: keep close to base.
            demo = dict(d.demographics)
            if "median_income" in demo and demo["median_income"]:
                demo["median_income"] = max(0.0, float(demo["median_income"]) * (1 + rng.gauss(0.0, jitter * 0.05)))
            if "poverty_rate" in demo:
                demo["poverty_rate"] = max(0.0, min(1.0, float(demo["poverty_rate"]) + rng.gauss(0.0, jitter * 0.02)))

            out.append(
                District(
                    district_id=f"{d.district_id}.s{i+1}",
                    name=f"{d.name} (sub {i+1})",
                    state_fips=d.state_fips,
                    cd=d.cd,
                    lean=lean,
                    population=sub_pop,
                    demographics=demo,
                    weights=w,
                )
            )

    return out
