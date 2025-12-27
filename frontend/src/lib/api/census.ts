import type { District, Issue } from "../api";
import { Random } from "../simulation/rng";

const DEFAULT_ACS_VARS = [
  "NAME",
  "B01001_001E",  // total population
  "B19013_001E",  // median household income
  "B17001_002E",  // poverty count
  "B17001_001E",  // poverty universe
];

function clamp(x: number, lo = -1.0, hi = 1.0): number {
  return Math.max(lo, Math.min(hi, x));
}

export async function fetchAcsDistricts(year: number, stateFips?: string, variables?: string[]) {
  const vars = variables || DEFAULT_ACS_VARS;
  if (!vars.includes("NAME")) vars.unshift("NAME");

  const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
  url.searchParams.set("get", vars.join(","));
  url.searchParams.set("for", "congressional district:*");
  if (stateFips) {
    url.searchParams.set("in", `state:${stateFips}`);
  }

  const r = await fetch(url.toString());
  if (!r.ok) {
    throw new Error(`Census API Error ${r.status}`);
  }
  const data: string[][] = await r.json();

  if (!data || data.length < 2) return [];

  const header = data[0];
  const rows = data.slice(1);

  return rows.map(row => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      rec[h] = row[i];
    });
    return rec;
  });
}

export function acsRowsToDistricts(rows: Record<string, string>[]): District[] {
  const scenario: Record<Issue, number> = {
    economy: 0.30,
    climate: 0.18,
    healthcare: 0.22,
    immigration: 0.15,
    education: 0.15,
  };

  const districts: District[] = [];

  for (const rec of rows) {
    const stateFips = rec["state"];
    const cd = rec["congressional district"];
    const name = rec["NAME"] || `State ${stateFips} CD ${cd}`;
    const pop = parseInt(rec["B01001_001E"] || "0", 10);
    const medIncome = parseFloat(rec["B19013_001E"] || "0");
    const povUniverse = parseFloat(rec["B17001_001E"] || "0");
    const povCount = parseFloat(rec["B17001_002E"] || "0");

    const povertyRate = povUniverse > 0 ? povCount / povUniverse : 0.0;

    // Weights logic
    const weights: Record<Issue, number> = { ...scenario };

    if (medIncome > 0) {
      const incomeNorm = Math.min(1.0, medIncome / 100000.0);
      weights.economy = clamp(weights.economy + 0.10 * (1 - incomeNorm), 0.05, 0.60);
      weights.education = clamp(weights.education + 0.05 * incomeNorm, 0.05, 0.50);
    }
    weights.healthcare = clamp(weights.healthcare + 0.08 * povertyRate, 0.05, 0.60);

    // Normalize
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const k of Object.keys(weights) as Issue[]) {
      weights[k] = weights[k] / (sum || 1.0);
    }

    const districtId = `${stateFips}-${cd}`;

    // Deterministic lean using seeded RNG based on ID string hash-ish
    // JS doesn't have built-in string hash, so simple sum
    let hash = 0;
    for (let i = 0; i < districtId.length; i++) {
      hash = ((hash << 5) - hash) + districtId.charCodeAt(i);
      hash |= 0;
    }
    const rng = new Random(hash);
    const lean = clamp(rng.uniform(-0.8, 0.8));

    districts.push({
      district_id: districtId,
      name,
      lean,
      population: pop,
      weights,
      // Extra fields for context
      demographics_text: `Med Income: $${medIncome}, Poverty: ${(povertyRate * 100).toFixed(1)}%`
    });
  }

  return districts.sort((a, b) => a.district_id.localeCompare(b.district_id));
}
