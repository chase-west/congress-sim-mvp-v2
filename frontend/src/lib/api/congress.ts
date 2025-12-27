import type { Bill, Issue } from "../api";

const API_KEY = import.meta.env.VITE_CONGRESS_API_KEY;
const BASE_URL = "https://api.congress.gov/v3";

// ------------------------------------------------------------------
// Fetchers
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Fetchers
// ------------------------------------------------------------------

async function fetchJson(endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(BASE_URL + endpoint);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const r = await fetch(url.toString());
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error(`Congress API Error ${r.status}`);
  }
  return r.json();
}

export async function fetchBillJson(congress: number, billType: string, billNumber: string) {
  return fetchJson(`/bill/${congress}/${billType.toLowerCase()}/${billNumber}`);
}

export async function fetchBillSummaries(congress: number, billType: string, billNumber: string) {
  const data = await fetchJson(`/bill/${congress}/${billType.toLowerCase()}/${billNumber}/summaries`);
  return data?.summaries || [];
}

export async function fetchRecentBills(limit = 20, offset = 0) {
  const data = await fetchJson("/bill", {
    limit: String(limit),
    offset: String(offset),
    sort: "updateDate+desc"
  });
  return data?.bills || [];
}

function billJsonToBillObj(data: any): Bill {
  // Structure: { bill: { ... } } or just { ... }
  const bill = data.bill || data;
  const title = bill.title || bill.shortTitle || bill.number || "Untitled Bill";

  // Summary extraction
  let summary = "";
  // In v3, summaries might be stored differently, but we use the helper fetchBillSummaries usually.
  // If we just got the bill object, it might have a 'summaries' field if expanded? usually not.
  // We rely on fetchRandomBill to do the heavy lifting of summary finding.
  // But if passed here:
  if (bill.summaries && Array.isArray(bill.summaries.summaries)) {
    const list = bill.summaries.summaries;
    const best = list.sort((a: any, b: any) => (b.text?.length || 0) - (a.text?.length || 0))[0];
    summary = best?.text || "";
  }

  if (!summary || summary.length < 50) {
    const latestText = bill.latestAction?.text;
    if (latestText) {
      summary = summary ? `${summary}\n\nLatest Action: ${latestText}` : latestText;
    }
  }

  summary = summary || "(No summary available)";

  // Clean HTML from summary if needed (often it is plain text or simple HTML)
  // Use DOMParser to be safe
  const doc = new DOMParser().parseFromString(summary, "text/html");
  const cleanSummary = doc.body.textContent || summary;

  return {
    title: String(title),
    summary: String(cleanSummary),
    text_content: undefined,
    // Deprecated: No longer guessing issue vector from text.
    // Agents now vote based on the full text.
    issue_vector: {
      economy: 0,
      climate: 0,
      healthcare: 0,
      immigration: 0,
      education: 0
    }
  };
}

export async function getRandomBill(): Promise<Bill> {
  // 1. Random page offset
  const offset = Math.floor(Math.random() * 450) + 50;
  let bills = await fetchRecentBills(30, offset);

  if (!bills || bills.length === 0) {
    console.warn("Offset fetch failed or empty, trying recent.");
    bills = await fetchRecentBills(30, 0);
  }

  if (!bills || bills.length === 0) {
    throw new Error("No bills found from Congress API.");
  }

  // Filter HR/S
  const pool = bills.filter((b: any) => ["HR", "S"].includes(b.type));
  const candidates = pool.length ? pool : bills;

  // Try 5 times to find a good one with a summary
  for (let i = 0; i < 5; i++) {
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    if (!choice) break;

    const { congress, type, number } = choice;
    if (!congress || !type || !number) continue;

    // Check summaries first
    const summaries = await fetchBillSummaries(congress, type, number);
    if (!summaries || summaries.length === 0) continue;

    // Fetch full bill details
    const raw = await fetchBillJson(congress, type, number);
    if (!raw) continue;

    const billObj = billJsonToBillObj(raw);

    // Inject best summary
    const best = summaries.sort((a: any, b: any) => (b.text?.length || 0) - (a.text?.length || 0))[0];
    if (best && best.text) {
      const doc = new DOMParser().parseFromString(best.text, "text/html");
      billObj.summary = doc.body.textContent || best.text;
    }

    // Try to get FULL TEXT if available (separate endpoint usually, but check textVersions)
    if (raw.bill?.textVersions?.url) {
      // We can't fetch this easily from browser due to CORS usually on XML. 
      // But we can check for text fields in recent API versions.
      // For now, append a note.
    }

    // Construct text_content
    const prefix = billObj.summary.length > 200 ? "DETAILED POLICY SUMMARY (CRS):\n\n" : "SUMMARY:\n\n";
    billObj.text_content = prefix + billObj.summary;

    if (raw.bill?.cboCostEstimates?.length) {
      billObj.text_content += "\n\nCBO COST ESTIMATES:\n" + raw.bill.cboCostEstimates.map((c: any) => `- ${c.title}: ${c.url}`).join("\n");
    }

    if (raw.bill?.laws?.length) {
      billObj.text_content += "\n\nRELATED LAWS:\n" + raw.bill.laws.map((l: any) => `- ${l.number} (${l.type})`).join("\n");
    }

    return billObj;
  }

  // Fallback
  const fallback = candidates[0];
  const raw = await fetchBillJson(fallback.congress, fallback.type, fallback.number);
  const b = billJsonToBillObj(raw);
  b.text_content = b.summary;
  return b;
}

export async function ingestBill(req: { congress: number, bill_type: string, bill_number: string }): Promise<Bill> {
  const raw = await fetchBillJson(req.congress, req.bill_type, req.bill_number);
  if (!raw) throw new Error("Bill not found");

  // Try to get summary too
  const summaries = await fetchBillSummaries(req.congress, req.bill_type, req.bill_number);
  const billObj = billJsonToBillObj(raw);

  if (summaries && summaries.length > 0) {
    const best = summaries.sort((a: any, b: any) => (b.text?.length || 0) - (a.text?.length || 0))[0];
    if (best && best.text) {
      const doc = new DOMParser().parseFromString(best.text, "text/html");
      billObj.summary = doc.body.textContent || best.text;
    }
  }
  return billObj;
}
