from __future__ import annotations

import csv
import io
from dataclasses import replace
from typing import Dict, Iterable, List, Optional, Tuple

from ..sim.agent import District


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def parse_house_csv_two_party(
    csv_text: str,
    *,
    state_fips_col: str,
    cd_col: str,
    dem_votes_col: str,
    rep_votes_col: str,
    delimiter: str = ",",
) -> Dict[str, float]:
    """Return mapping {"<state_fips>-<cd>": lean} where lean in [-1,1].

    lean = 2*(dem_share - 0.5), so +1 is 100% Dem, -1 is 100% Rep.
    """
    f = io.StringIO(csv_text)
    reader = csv.DictReader(f, delimiter=delimiter)
    out: Dict[str, float] = {}
    for row in reader:
        s = (row.get(state_fips_col) or "").strip()
        cd = (row.get(cd_col) or "").strip()
        if not s or not cd:
            continue

        try:
            dem = float((row.get(dem_votes_col) or "0").replace(",", ""))
            rep = float((row.get(rep_votes_col) or "0").replace(",", ""))
        except Exception:
            continue

        denom = dem + rep
        if denom <= 0:
            continue
        dem_share = dem / denom
        lean = _clamp(2.0 * (dem_share - 0.5))

        # Normalize CD code (strip leading zeros except keep 'AL' if present)
        cd_norm = cd
        if cd_norm.isdigit():
            cd_norm = str(int(cd_norm))
        key = f"{s.zfill(2)}-{cd_norm}"
        out[key] = lean
    return out


def apply_lean(districts: List[District], lean_map: Dict[str, float], strength: float = 1.0) -> List[District]:
    strength = max(0.0, min(1.0, strength))
    out: List[District] = []
    for d in districts:
        key = None
        if d.state_fips and d.cd:
            key = f"{str(d.state_fips).zfill(2)}-{str(d.cd)}"
        if key and key in lean_map:
            new_lean = _clamp(d.lean * (1.0 - strength) + lean_map[key] * strength)
            out.append(replace(d, lean=new_lean))
        else:
            out.append(d)
    return out
