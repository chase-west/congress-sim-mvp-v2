import type { District, DistrictSummary } from "../api";

let activeDistricts: District[] = [];
let activeSummary: DistrictSummary = {
  source: "none",
  meta: {},
  count: 0,
  sample: []
};

export function getActiveDistricts(): District[] {
  return activeDistricts;
}

export function setActiveDistricts(districts: District[], source: string, meta: Record<string, any>) {
  activeDistricts = districts;
  activeSummary = {
    source,
    meta,
    count: districts.length,
    sample: districts.slice(0, 5)
  };
}

export function getActiveSummary(): DistrictSummary {
  return activeSummary;
}

export function loadMockDistricts(): District[] {
  // Simple mock data for testing without API
  return [
    {
      district_id: "mock-1",
      name: "Mock District 1 (Left)",
      lean: 0.6,
      population: 750000,
      weights: { economy: 0.2, climate: 0.3, healthcare: 0.3, immigration: 0.1, education: 0.1 },
      demographics_text: "Urban, High Income"
    },
    {
      district_id: "mock-2",
      name: "Mock District 2 (Right)",
      lean: -0.6,
      population: 750000,
      weights: { economy: 0.4, climate: 0.1, healthcare: 0.1, immigration: 0.3, education: 0.1 },
      demographics_text: "Rural, Middle Income"
    },
    {
      district_id: "mock-3",
      name: "Mock District 3 (Center)",
      lean: 0.05,
      population: 750000,
      weights: { economy: 0.5, climate: 0.1, healthcare: 0.1, immigration: 0.1, education: 0.2 },
      demographics_text: "Suburban"
    }
  ];
}
