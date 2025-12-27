from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional, Literal

Issue = Literal["economy","climate","healthcare","immigration","education"]

class Bill(BaseModel):
    title: str = Field(..., examples=["Clean Energy Incentives Act"])
    summary: str = Field(..., examples=["Tax credits for renewable energy and grid upgrades."])
    # Each issue is in [-1, 1]. Positive means "left/progressive" direction in this toy model.
    issue_vector: Dict[Issue, float] = Field(default_factory=dict)
    text_content: Optional[str] = None

class SimRequest(BaseModel):
    bill: Bill
    num_members: int = Field(200, ge=10, le=1000)
    rounds: int = Field(3, ge=1, le=10)
    use_llm: bool = False
    llm_model: str = "llama3.1:8b"
    seed: Optional[int] = None

class Speech(BaseModel):
    member_id: str
    stance: Literal["support","oppose","amend"]
    text: str
    rationale: Dict[str, float]  # utility contributions by issue

class VoteResult(BaseModel):
    yes: int
    no: int
    abstain: int
    passed: bool
    threshold: float

class RoundResult(BaseModel):
    round_index: int
    speeches: List[Speech]
    vote: VoteResult

class SimResponse(BaseModel):
    members: int
    bill: Bill
    rounds: List[RoundResult]
    final_passed: bool
    notes: List[str] = []


class DistrictSummary(BaseModel):
    source: str
    meta: Dict[str, Any] = {}
    count: int
    sample: List[Dict[str, Any]] = []


class LoadAcsRequest(BaseModel):
    year: int = Field(2023, ge=2009, le=2100)
    state_fips: Optional[str] = Field(None, examples=["32"])
    variables: Optional[List[str]] = None
    multiplier: int = Field(1, ge=1, le=20, description="Splits per district")
    jitter: float = Field(0.05, ge=0.0, le=0.5, description="Noise factor for splits")


class MakeSyntheticRequest(BaseModel):
    multiplier: int = Field(2, ge=1, le=20)
    jitter: float = Field(0.12, ge=0.0, le=1.0)
    seed: Optional[int] = None


class LoadElectionCsvUrlRequest(BaseModel):
    """Loads a CSV from a public URL and uses Dem/Rep vote totals to set district lean."""

    url: str
    state_fips_col: str = "state_fips"
    cd_col: str = "district"
    dem_votes_col: str = "dem_votes"
    rep_votes_col: str = "rep_votes"
    delimiter: str = ","
    strength: float = 1.0


class CongressGovIngestRequest(BaseModel):
    congress: int = Field(..., ge=1, le=300)
    bill_type: str = Field(..., examples=["hr", "s"])
    bill_number: str = Field(..., examples=["1", "3076"])
