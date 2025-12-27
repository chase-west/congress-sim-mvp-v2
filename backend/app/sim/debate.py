from __future__ import annotations
from typing import Dict, List, Literal, Optional
import httpx

from .agent import Member, Issue

Stance = Literal["support","oppose","amend"]

def template_speech(member: Member, stance: Stance, issue_vector: Dict[Issue, float]) -> str:
    # Keep it short and structured. Avoid pretending to be a real person.
    top = sorted(member.district.weights.items(), key=lambda kv: kv[1], reverse=True)[:2]
    top_issues = [k for k,_ in top]
    lean_word = "left-leaning" if member.district.lean > 0.15 else "right-leaning" if member.district.lean < -0.15 else "mixed"
    dir_words = []
    for iss in top_issues:
        v = issue_vector.get(iss, 0.0)
        if abs(v) < 0.15:
            continue
        dir_words.append(f"{iss} {'expands' if v>0 else 'restricts'} policy")
    dir_clause = ", ".join(dir_words) if dir_words else "the bill is mixed across issues"
    if stance == "support":
        return (f"I support this bill. My district is {lean_word}, and {dir_clause}. "
                f"On net, it improves outcomes my constituents prioritize.")
    if stance == "oppose":
        return (f"I oppose this bill. My district is {lean_word}, and {dir_clause}. "
                f"On net, it cuts against constituent priorities or creates tradeoffs we can't justify.")
    return (f"I want amendments. My district is {lean_word}; we should keep the benefits but reduce the downsides. "
            f"Let's adjust the bill to better match the median voter in the district.")

async def ollama_generate(prompt: str, model: str, base_url: str = "http://localhost:11434") -> Optional[str]:
    # Ollama generate endpoint: POST /api/generate
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{base_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            r.raise_for_status()
            data = r.json()
            return data.get("response")
    except Exception:
        return None

def build_prompt(member: Member, stance: Stance, issue_vector: Dict[Issue, float]) -> str:
    # Constraint: don't mimic real-world identifiable politicians.
    # We ask for a generic representative voice grounded in district weights.
    weights = member.district.weights
    return (
        "You are a generic elected representative in a simulated legislature. "
        "Do NOT reference real people, parties, or scandals. "
        "Write a concise argument (<=90 words).\n\n"
        f"District lean (right=-1 to left=+1): {member.district.lean}\n"
        f"Member ideology (right=-1 to left=+1): {member.ideology}\n"
        f"District issue salience weights: {weights}\n"
        f"Bill issue vector (left/progressive positive): {issue_vector}\n"
        f"Stance: {stance}\n"
        "Argument:"
    )

async def generate_speech(member: Member, stance: Stance, issue_vector: Dict[Issue, float],
                          use_llm: bool, llm_model: str) -> str:
    if not use_llm:
        return template_speech(member, stance, issue_vector)

    prompt = build_prompt(member, stance, issue_vector)
    out = await ollama_generate(prompt, model=llm_model)
    return out.strip() if out else template_speech(member, stance, issue_vector)
