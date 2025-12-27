from dataclasses import dataclass, field
from typing import Dict, Literal, Optional

Issue = Literal["economy","climate","healthcare","immigration","education"]

@dataclass(frozen=True)
class District:
    district_id: str
    name: str
    state_fips: Optional[str] = None
    cd: Optional[str] = None
    lean: float = 0.0                 # -1..+1 (right..left)
    population: int = 0
    demographics: Dict[str, float] = field(default_factory=dict)
    weights: Dict[Issue, float] = field(default_factory=dict)  # issue salience in the district

@dataclass
class Member:
    member_id: str
    district: District
    ideology: float             # -1..+1 (right..left)
    party_hint: str             # purely cosmetic for UI (not used in voting)

    def utility_by_issue(self, issue_vector: Dict[Issue, float]) -> Dict[str, float]:
        contrib: Dict[str, float] = {}
        for issue, v in issue_vector.items():
            w = float(self.district.weights.get(issue, 0.0))
            contrib[issue] = w * v * float(self.ideology)
        # district lean bias: members track district lean somewhat
        contrib["district_lean_bias"] = 0.25 * float(self.district.lean) * float(self.ideology)
        return contrib

    def utility(self, issue_vector: Dict[Issue, float]) -> float:
        return sum(self.utility_by_issue(issue_vector).values())
