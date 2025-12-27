import type { District, Issue } from "../api";
import { Random } from "./rng";

function clamp(x: number, lo = -1.0, hi = 1.0): number {
  return Math.max(lo, Math.min(hi, x));
}

export function splitDistricts(
  base: District[],
  multiplier: number,
  jitter: number,
  seed?: number | null
): District[] {
  if (multiplier <= 1) return [...base];

  const rng = new Random(seed);
  const out: District[] = [];

  for (const d of base) {
    const subPop = Math.max(1, Math.floor(d.population / multiplier));

    for (let i = 0; i < multiplier; i++) {
      // Jitter lean
      const lean = clamp(d.lean + rng.gauss(0.0, jitter * 0.35));

      // Jitter weights
      const w: Record<Issue, number> = { ...d.weights };
      let sum = 0;
      for (const k of Object.keys(w) as Issue[]) {
        w[k] = Math.max(0.01, w[k] + rng.gauss(0.0, jitter * 0.08));
        sum += w[k];
      }
      // Normalize
      for (const k of Object.keys(w) as Issue[]) {
        w[k] = w[k] / (sum || 1.0);
      }

      out.push({
        district_id: `${d.district_id}.s${i + 1}`,
        name: `${d.name} (sub ${i + 1})`,
        lean,
        population: subPop,
        weights: w,
        demographics_text: d.demographics_text
      });
    }
  }
  return out;
}
