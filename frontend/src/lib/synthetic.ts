
import { type District, type Issue } from "./api";

// --- Data Banks for "Mad Libs" Generation ---

const GEOGRAPHIES = [
  "sprawling suburban area", "dense urban center", "rural agricultural region",
  "coastal tourist destination", "declining industrial belt", "fast-growing tech corridor",
  "quiet bedroom community", "remote mountain district", "historic port city",
  "university town and surrounding farmland"
];

const INDUSTRIES = [
  "Technology", "Agriculture", "Manufacturing", "Tourism", "Healthcare",
  "Finance", "Energy", "Education", "Logistics", "Retail"
];

const DEMOGRAPHICS = [
  "working-class families", "affluent professionals", "diverse immigrant communities",
  "retirees and seniors", "young college graduates", "multi-generational local families"
];

const PRIORITIES = [
  "job growth", "environmental protection", "lower taxes", "affordable housing",
  "public safety", "education funding", "healthcare access", "infrastructure improvement"
];

// --- Helper Functions ---

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max);
}

// --- Generator ---

export function generateSyntheticDistricts(count: number, seed?: number): District[] {
  // Note: Simple Math.random() is used here. 
  // For a true seeded simulation we'd need a seedable PRNG, but for MVP this is fine.

  const districts: District[] = [];

  for (let i = 0; i < count; i++) {
    const lean = randomFloat(-0.6, 0.6); // Range -1 (Right) to 1 (Left)

    // Correlate geography with lean slightly
    let geo = pick(GEOGRAPHIES);
    if (lean < -0.4 && Math.random() > 0.5) geo = "rural agricultural region";
    if (lean > 0.4 && Math.random() > 0.5) geo = "dense urban center";

    const localInds = pickN(INDUSTRIES, 2);
    const primDemo = pick(DEMOGRAPHICS);
    const priority = pick(PRIORITIES);

    // Generate Issue Weights based on "Persona"
    const weights: Record<Issue, number> = {
      economy: randomFloat(0.3, 0.9), // Everyone cares about economy
      climate: randomFloat(0.1, 0.8),
      healthcare: randomFloat(0.2, 0.9),
      immigration: randomFloat(0.1, 0.8),
      education: randomFloat(0.2, 0.8),
    };

    // Adjust weights based on keywords
    if (localInds.includes("Energy") || localInds.includes("Manufacturing")) {
      weights.climate = Math.max(0.1, weights.climate - 0.2); // Usually skeptical of reg
      weights.economy += 0.2;
    }
    if (localInds.includes("Technology") || geo.includes("urban")) {
      weights.climate += 0.2;
      weights.education += 0.1;
    }
    if (geo.includes("rural")) {
      weights.immigration += 0.1; // Salient issue
      weights.climate = Math.min(0.7, weights.climate);
    }

    // Normalize weights roughly
    for (const key in weights) {
      weights[key as Issue] = clamp(weights[key as Issue], 0, 1);
    }

    const description = `A ${geo} characterized by a mix of ${localInds[0].toLowerCase()} and ${localInds[1].toLowerCase()} sectors. The district is home to many ${primDemo} who prioritize ${priority}.`;

    districts.push({
      district_id: `SYN-${i + 1}`,
      name: `District ${i + 1}`,
      lean,
      population: Math.floor(randomFloat(700000, 800000)),
      description,
      industries: localInds,
      demographics_text: `Predominantly ${primDemo}`,
      // Add weights to satisfy simulation engine requirements
      weights: {
        economy: clamp(0.5 + (Math.random() * 0.4 - 0.2) + (lean * 0.1), 0, 1), // Slightly correlated with lean
        climate: clamp(0.5 + (Math.random() * 0.4 - 0.2) - (lean * 0.1), 0, 1), // Slightly anti-correlated with lean
        healthcare: clamp(0.5 + (Math.random() * 0.4 - 0.2), 0, 1),
        immigration: clamp(0.5 + (Math.random() * 0.4 - 0.2) - (lean * 0.15), 0, 1), // More anti-correlated
        education: clamp(0.5 + (Math.random() * 0.4 - 0.2) + (lean * 0.05), 0, 1), // Slightly correlated
      }
    });
  }

  return districts;
}
