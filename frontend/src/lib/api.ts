import { fetchAcsDistricts, acsRowsToDistricts } from "./api/census";
import { fetchBillJson, ingestBill, getRandomBill as fetchRandomBill } from "./api/congress";
import { runSimulation } from "./simulation/engine";
import { getActiveDistricts, getActiveSummary, loadMockDistricts, setActiveDistricts } from "./simulation/state";
import { splitDistricts } from "./simulation/synthetic";

// Re-export types so we don't break other files imports
export type Issue = "economy" | "climate" | "healthcare" | "immigration" | "education";

export type Bill = {
  title: string;
  summary: string;
  text_content?: string;
  issue_vector: Record<Issue, number>;
};

export type SimRequest = {
  bill: Bill;
  num_members: number;
  rounds: number;
  use_llm: boolean;
  llm_model: string;
  seed?: number | null;
};

export type Speech = {
  member_id: string;
  stance: "support" | "oppose" | "amend";
  text: string;
  rationale: Record<string, number>;
};

export type Vote = {
  yes: number;
  no: number;
  abstain: number;
  passed: boolean;
  threshold: number;
};

export type Round = {
  round_index: number;
  speeches: Speech[];
  vote: Vote;
};

export type SimResponse = {
  members: number;
  bill: Bill;
  rounds: Round[];
  final_passed: boolean;
  notes: string[];
};

export type District = {
  district_id: string;
  name: string;
  lean: number;
  population: number;
  weights: Record<Issue, number>;
  // Rich new fields
  description?: string;
  industries?: string[];
  demographics_text?: string;
};

export type DistrictSummary = {
  source: string;
  meta: Record<string, any>;
  count: number;
  sample: District[];
};

export type LoadAcsRequest = {
  year: number;
  state_fips?: string;
  variables?: string[] | null;
  multiplier?: number; // 1 = normal, >1 = supersampled
  jitter?: number;
};

export type MakeSyntheticRequest = {
  multiplier: number;
  jitter: number;
  seed?: number | null;
};

export type CongressGovIngestRequest = {
  congress: number;
  bill_type: string;
  bill_number: string;
};

// =====================================================================
// API IMPLEMENTATIONS (CLIENT-SIDE NOW)
// =====================================================================

export async function simulate(req: SimRequest): Promise<SimResponse> {
  const districts = getActiveDistricts();
  if (districts.length === 0) {
    throw new Error("No active districts loaded. Please Load Districts first.");
  }

  const result = await runSimulation(
    districts,
    req.num_members,
    req.rounds,
    req.bill, // CHANGED: Pass full bill
    req.use_llm,
    req.llm_model,
    req.seed || null
  );

  const notes = [];
  if (req.use_llm) {
    notes.push("Debate & Votes: AI Agents debating and voting based on bill text.");
  } else {
    notes.push("Debate & Votes: Template fallback (fast mode).");
  }
  notes.push("Detailed logs available in console.");
  notes.push("Ran entirely in your browser!");

  return {
    members: result.members,
    bill: req.bill,
    rounds: result.rounds,
    final_passed: result.final_passed,
    notes
  };
}

export async function getDistrictSummary(): Promise<DistrictSummary> {
  // Just return local state
  return getActiveSummary();
}

export async function useMockDistricts(): Promise<DistrictSummary> {
  const mocks = loadMockDistricts();
  setActiveDistricts(mocks, "mock", {});
  return getActiveSummary();
}

export async function loadAcsDistricts(req: LoadAcsRequest): Promise<DistrictSummary> {
  try {
    const rows = await fetchAcsDistricts(req.year, req.state_fips, req.variables || undefined);
    // @ts-ignore - rows are string[][] or object array, census.ts handles it but let's be safe
    // Actually census.ts returns Record<string, string>[] which matches acsRowsToDistricts input
    let districts = acsRowsToDistricts(rows as any);

    if (districts.length === 0) {
      throw new Error("No districts returned from Census API.");
    }

    if (req.multiplier && req.multiplier > 1) {
      districts = splitDistricts(districts, req.multiplier, req.jitter || 0.1);
    }

    setActiveDistricts(districts, "acs", req);
    return getActiveSummary();
  } catch (e: any) {
    console.error("ACS Load Failed", e);
    throw new Error("Failed to load ACS data: " + e.message);
  }
}

export async function makeSyntheticDistricts(req: MakeSyntheticRequest): Promise<DistrictSummary> {
  const base = getActiveDistricts();
  if (base.length === 0) {
    throw new Error("No active districts to split from.");
  }
  const synthetic = splitDistricts(base, req.multiplier, req.jitter, req.seed);
  const meta = { ...getActiveSummary().meta, ...req };
  setActiveDistricts(synthetic, "synthetic", meta);
  return getActiveSummary();
}

export async function ingestBillFromCongressGov(req: CongressGovIngestRequest): Promise<Bill> {
  return ingestBill(req);
}

export async function getRandomBill(): Promise<Bill> {
  return fetchRandomBill();
}
