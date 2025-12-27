from __future__ import annotations
import random, math
from typing import Dict, List, Tuple

from .agent import District, Member, Issue
from .debate import generate_speech

def sample_members(districts: List[District], n: int, rng: random.Random) -> List[Member]:
    # Weight by population to approximate representational density.
    pops = [max(1, d.population) for d in districts]
    total = float(sum(pops))
    probs = [p/total for p in pops]

    members: List[Member] = []
    for i in range(n):
        d = rng.choices(districts, weights=probs, k=1)[0]
        # ideology roughly tracks district lean but with noise
        ideology = max(-1.0, min(1.0, rng.gauss(mu=d.lean, sigma=0.35)))
        party_hint = "Blue" if ideology > 0.15 else "Red" if ideology < -0.15 else "Purple"
        members.append(Member(member_id=f"M-{i+1:04d}", district=d, ideology=ideology, party_hint=party_hint))
    return members

def pick_spokespeople(members: List[Member], k: int = 7) -> List[Member]:
    # Choose a small set for debate to keep compute reasonable.
    sorted_m = sorted(members, key=lambda m: m.ideology)
    if len(sorted_m) <= k:
        return sorted_m
    idxs = [0, len(sorted_m)//4, len(sorted_m)//2, 3*len(sorted_m)//4, len(sorted_m)-1]
    # Keep uniqueness by member_id (Member is not hashable).
    chosen: List[Member] = []
    seen = set()
    for i in idxs:
        m = sorted_m[i]
        if m.member_id not in seen:
            chosen.append(m)
            seen.add(m.member_id)

    mid = sorted_m[len(sorted_m)//4 : 3*len(sorted_m)//4]
    while len(chosen) < k and mid:
        m = random.choice(mid)
        if m.member_id not in seen:
            chosen.append(m)
            seen.add(m.member_id)
    return chosen

def vote(members: List[Member], issue_vector: Dict[Issue, float], threshold: float = 0.5) -> Tuple[int,int,int,bool]:
    yes=no=abstain=0
    for m in members:
        u = m.utility(issue_vector)
        # abstain if near-indifferent
        if abs(u) < 0.03:
            abstain += 1
        elif u > 0:
            yes += 1
        else:
            no += 1
    passed = (yes / max(1, (yes+no))) >= threshold
    return yes, no, abstain, passed

def propose_amendment(issue_vector: Dict[Issue, float], members: List[Member]) -> Dict[Issue, float]:
    # Simple "median pull": move each issue a bit toward the median member's ideology sign.
    sorted_m = sorted(members, key=lambda m: m.ideology)
    median = sorted_m[len(sorted_m)//2].ideology if sorted_m else 0.0
    amended = dict(issue_vector)
    for k, v in issue_vector.items():
        # pull v toward 0 if median opposes the direction
        step = 0.12
        if (v > 0 and median < 0) or (v < 0 and median > 0):
            amended[k] = v * (1 - step)
        else:
            amended[k] = max(-1.0, min(1.0, v + step * (0.0 if abs(v) < 0.2 else math.copysign(0.08, v))))
    return amended

async def run_simulation(
    districts: List[District],
    num_members: int,
    rounds: int,
    issue_vector: Dict[Issue, float],
    use_llm: bool,
    llm_model: str,
    seed: int | None
):
    rng = random.Random(seed)
    if not districts:
        raise ValueError("No active districts are loaded.")
    members = sample_members(districts, num_members, rng)

    current = dict(issue_vector)
    all_rounds = []

    for r in range(rounds):
        spokes = pick_spokespeople(members, k=7)
        speeches = []
        # Determine stance by utility sign
        for s in spokes:
            u = s.utility(current)
            stance = "support" if u > 0.05 else "oppose" if u < -0.05 else "amend"
            txt = await generate_speech(s, stance, current, use_llm=use_llm, llm_model=llm_model)
            speeches.append({
                "member_id": s.member_id,
                "stance": stance,
                "text": txt,
                "rationale": s.utility_by_issue(current),
            })

        yes, no, abstain, passed = vote(members, current, threshold=0.5)
        all_rounds.append({
            "round_index": r,
            "speeches": speeches,
            "vote": {
                "yes": yes, "no": no, "abstain": abstain,
                "passed": passed, "threshold": 0.5
            }
        })

        # If it didn't pass and more rounds remain, amend toward median.
        if (not passed) and (r < rounds - 1):
            current = propose_amendment(current, members)

    final_passed = all_rounds[-1]["vote"]["passed"] if all_rounds else False
    return {
        "members": num_members,
        "rounds": all_rounds,
        "final_passed": final_passed,
    }
