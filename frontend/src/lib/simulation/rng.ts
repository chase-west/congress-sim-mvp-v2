export class Random {
  private seed: number;

  constructor(seed: number | null | undefined) {
    this.seed = seed ?? Date.now();
  }

  // Linear Congruential Generator (simple, fast)
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  // Returns random float [min, max)
  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  // Box-Muller transform for Gaussian distribution
  gauss(mu: number, sigma: number): number {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return num * sigma + mu;
  }

  // Weighted choice
  choice<T>(items: T[], weights?: number[]): T {
    if (!items.length) throw new Error("Empty items");
    if (!weights) return items[Math.floor(this.next() * items.length)];

    const total = weights.reduce((a, b) => a + b, 0);
    const r = this.next() * total;
    let sum = 0;
    for (let i = 0; i < items.length; i++) {
      sum += weights[i];
      if (r < sum) return items[i];
    }
    return items[items.length - 1];
  }

  // Multiple weighted choices with replacement
  choices<T>(items: T[], weights: number[], k: number): T[] {
    const res: T[] = [];
    for (let i = 0; i < k; i++) {
      res.push(this.choice(items, weights));
    }
    return res;
  }
}
