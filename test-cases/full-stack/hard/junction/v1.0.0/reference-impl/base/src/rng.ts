// A tiny deterministic PRNG (mulberry32). Terrain generation and vehicle spawns are
// seeded so a city plays out the same way from the same seed — reproducible for the
// proof captures and the balance harness — while still varying seed to seed. Mirrors the
// valence reference's `Rng` verbatim.
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  bool(pTrue: number): boolean {
    return this.next() < pTrue;
  }
}
