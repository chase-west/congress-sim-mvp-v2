from __future__ import annotations

from typing import Any, Dict, Optional
import os
import re
import httpx

from ..models import Bill
from ..sim.agent import Issue


DEFAULT_BASE = os.getenv("CONGRESS_API_BASE", "https://api.congress.gov/v3")


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


async def fetch_bill_json(
    *,
    congress: int,
    bill_type: str,
    bill_number: str,
    api_key: str,
    base_url: str = DEFAULT_BASE,
    timeout_s: float = 20.0,
) -> Dict[str, Any]:
    """Fetch a single bill from the Congress.gov v3 API.

    Common base URLs in the docs:
    - https://api.congress.gov/v3
    - https://api.data.gov/congress/v3
    """
    bill_type = bill_type.lower()
    url = f"{base_url.rstrip('/')}/bill/{congress}/{bill_type}/{bill_number}"
    params = {"format": "json", "api_key": api_key}

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        r = await client.get(url, params=params)
        return r.json()


async def fetch_bill_text(
    *,
    congress: int,
    bill_type: str,
    bill_number: str,
    api_key: str,
    base_url: str = DEFAULT_BASE,
) -> Optional[str]:
    """Fetch text versions and return the latest one as a plain string (stripped)."""
    # https://api.congress.gov/v3/bill/{congress}/{billType}/{billNumber}/text
    url = f"{base_url.rstrip('/')}/bill/{congress}/{bill_type}/{bill_number}/text"
    params = {"format": "json", "api_key": api_key}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
            
            # The API returns a list of text versions
            texts = data.get("textVersions", [])
            if not texts:
                return None
            
            # Grab the last one (usually latest)
            latest = texts[-1]
            formats = latest.get("formats", [])
            
            text_url = None
            for fmt in formats:
                # Look for "Formatted Text" or "Text"
                if fmt.get("type") == "Formatted Text" or fmt.get("type") == "Text":
                    text_url = fmt.get("url")
                    break
            
            if not text_url:
                return None

            # Fetch the actual HTML/XML content
            # Note: This is an external link, usually to congress.gov, might not need API key?
            # Usually these are public URLs.
            tr = await client.get(text_url)
            tr.raise_for_status()
            raw_html = tr.text
            
            # Naive HTML stripping for MVP (avoiding beautifulsoup dependency)
            # Remove scripts and styles first
            no_script = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', raw_html, flags=re.DOTALL)
            # Remove tags
            clean_text = re.sub(r'<[^>]+>', ' ', no_script)
            # Normalize whitespace
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()
            
            return clean_text
    except Exception as e:
        print(f"Error fetching text: {e}")
        return None


async def fetch_recent_bills(
    api_key: str,
    limit: int = 20,
    offset: int = 0,
    base_url: str = DEFAULT_BASE,
) -> list[dict]:
    """Fetch a list of bills with pagination support."""
    url = f"{base_url.rstrip('/')}/bill"
    params = {
        "format": "json",
        "api_key": api_key,
        "limit": limit,
        "offset": offset,
        "sort": "updateDate desc",
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
        return data.get("bills", [])



    
async def fetch_bill_summaries(
    *,
    congress: int,
    bill_type: str,
    bill_number: str,
    api_key: str,
    base_url: str = DEFAULT_BASE,
) -> list[dict]:
    """Fetch all summaries for a bill (CRS reports, etc)."""
    bill_type = bill_type.lower()
    url = f"{base_url.rstrip('/')}/bill/{congress}/{bill_type}/{bill_number}/summaries"
    params = {"format": "json", "api_key": api_key}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
            # 404 means no summaries, which is fine
            if r.status_code == 404:
                return []
            r.raise_for_status()
            data = r.json()
            return data.get("summaries", [])
    except Exception:
        return []


async def fetch_random_bill(
    api_key: str,
    base_url: str = DEFAULT_BASE,
) -> Bill:
    """Pick a random mature bill. ensuring it has content."""
    import random
    
    choice = None
    bills = []

    # 1. Get a random "page" of bills to ensure matched maturity
    # Catch errors here in case offset is invalid or API is flaky
    try:
        offset = random.randint(50, 500)
        bills = await fetch_recent_bills(api_key, limit=30, offset=offset, base_url=base_url)
    except Exception:
        # If offset fetch fails, swallow error and try no-offset below
        pass
    
    if not bills:
        # Fallback to recent if offset failed or empty
        try:
            bills = await fetch_recent_bills(api_key, limit=30, base_url=base_url)
        except Exception:
             # Critical failure fallback
             blob = _text_blob("API Error", "Could not reach Congress.gov")
             return Bill(title="API Error", summary="Check connection.", issue_vector=guess_issue_vector_from_text(blob))
             
        if not bills:
             blob = _text_blob("No Bills", "Empty list returned.")
             return Bill(title="No Bills Found", summary="Try again.", issue_vector=guess_issue_vector_from_text(blob))

    # Filter for substantive bills (HR/S)
    substantive = [b for b in bills if b.get("type") in ["HR", "S"]]
    pool = substantive if substantive else bills

    last_error_bill = None

    # Retry loop: FAST check for summaries first
    for _ in range(5):
        try:
            choice = random.choice(pool)
        except IndexError:
            break # Pool empty?

        
        congress = choice.get("congress")
        bill_type = choice.get("type")
        number = choice.get("number")
        if not (congress and bill_type and number):
            continue

        # Fast Check: Does it have a summary?
        # We hit the summaries endpoint FIRST. If empty, we skip this bill immediately.
        # This prevents loading "empty" bills.
        try:
            summaries_list = await fetch_bill_summaries(
                congress=congress,
                bill_type=bill_type,
                bill_number=str(number),
                api_key=api_key,
                base_url=base_url
            )
        except Exception:
            continue
            
        if not summaries_list:
            # No summary? Skip it. User wants details.
            continue

        # Found a summary! Now fetch the full details for the title/metadata
        try:
            raw_json = await fetch_bill_json(
                congress=congress,
                bill_type=bill_type,
                bill_number=str(number),
                api_key=api_key,
                base_url=base_url
            )
        except Exception:
            continue

        # Build the Object
        bill = bill_json_to_bill_obj(raw_json)
        
        # Inject the best summary
        best = max(summaries_list, key=lambda x: len(x.get("text", "") or ""))
        best_text = best.get("text", "").strip()
        
        if len(best_text) > len(bill.summary):
            bill.summary = best_text
            
        # Always populate text_content if we have a summary, so the frontend box is filled.
        if bill.summary and len(bill.summary.strip()) > 10:
             prefix = "DETAILED POLICY SUMMARY (CRS):\n\n" if len(bill.summary) > 200 else "SUMMARY:\n\n"
             bill.text_content = prefix + bill.summary
        
        return bill

    # If we fall through, just return a fallback from the pool (better than crashing or empty)
    # We take the last choice and do best effort.
    if choice:
        try:
             # Just fetch basic JSON if summaries failed
             raw = await fetch_bill_json(congress=choice.get("congress"), bill_type=choice.get("type"), bill_number=str(choice.get("number")), api_key=api_key, base_url=base_url)
             b_fallback = bill_json_to_bill_obj(raw)
             # Fill text content with summary
             b_fallback.text_content = b_fallback.summary
             return b_fallback
        except:
             pass
            
    blob = _text_blob("Error Finding Bill", "Could not find a bill with detailed summaries.")
    return Bill(title="Simulation Error", summary="Please try again.", issue_vector=guess_issue_vector_from_text(blob))


def _text_blob(*parts: Optional[str]) -> str:
    return "\n".join([p for p in parts if p])


def guess_issue_vector_from_text(text: str) -> Dict[Issue, float]:
    """Heuristic mapping from bill text -> issue vector.

    This is intentionally transparent and cheap. Replace later with a learned classifier
    or local LLM extraction if you want higher fidelity.
    """
    t = text.lower()

    vec: Dict[Issue, float] = {
        "economy": 0.0,
        "climate": 0.0,
        "healthcare": 0.0,
        "immigration": 0.0,
        "education": 0.0,
    }

    # climate
    if re.search(r"\b(climate|renewable|emissions|clean energy|solar|wind|carbon)\b", t):
        vec["climate"] += 0.6

    # economy (directional guess: spending/credits as '+'; deregulation/cuts as '-')
    if re.search(r"\b(tax credit|grant|subsidy|infrastructure|investment|jobs?|minimum wage)\b", t):
        vec["economy"] += 0.5
    if re.search(r"\b(tax cut|deregulat|reduce regulation|privatiz)\b", t):
        vec["economy"] -= 0.4

    # healthcare
    if re.search(r"\b(medicare|medicaid|healthcare|hospital|insurance|prescription|drug price)\b", t):
        vec["healthcare"] += 0.55

    # immigration (directional guess: border/security '-')
    if re.search(r"\b(immigration|asylum|visa|refugee|citizenship)\b", t):
        vec["immigration"] += 0.25
    if re.search(r"\b(border|deport|detention|security wall|e-verify)\b", t):
        vec["immigration"] -= 0.55

    # education
    if re.search(r"\b(education|school|student loan|pell grant|teacher|university|college)\b", t):
        vec["education"] += 0.5

    # squash + normalize to [-1,1] per dimension
    vec = {k: _clamp(float(v)) for k, v in vec.items()}
    return vec


def bill_json_to_bill_obj(data: Dict[str, Any]) -> Bill:
    """Extract a minimal Bill object from the Congress.gov bill response."""
    # The response structure includes a top-level 'bill' element in the v3 API.
    bill = data.get("bill") or data
    title = bill.get("title") or bill.get("shortTitle") or bill.get("number") or "Untitled Bill"

    # Best-effort summary extraction. Not all bills have summaries.
    # We prioritize the longest summary (usually CRS detailed report) over short 'Introduced' blurbs.
    summary = ""
    if isinstance(bill.get("summaries"), dict):
        s_list = bill["summaries"].get("summaries", [])
        if isinstance(s_list, list) and s_list:
            # Find the summary with the longest text content
            best_summary = max(s_list, key=lambda x: len(x.get("text", "") or ""))
            summary = best_summary.get("text", "")

    # Fallback to latest action if absolutely no summary found
    if not summary or len(summary) < 50:
        latest_text = bill.get("latestAction", {}).get("text")
        if latest_text:
            if summary:
                 summary = summary + "\n\nLatest Action: " + latest_text
            else:
                 summary = latest_text
    
    summary = summary or "(No summary available from API response.)"

    blob = _text_blob(title, summary)
    issue_vector = guess_issue_vector_from_text(blob)
    
    # We return the Bill object. 
    # Note: text_content is intentionally left None here; fetch_random_bill populates it 
    # if it fetches full text, OR logic there can use this improved summary as a fallback.
    return Bill(
        title=str(title), 
        summary=str(summary), 
        issue_vector=issue_vector,
        text_content=None 
    )
