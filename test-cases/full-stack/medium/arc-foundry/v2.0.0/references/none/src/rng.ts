// A small 32-bit generator held as one number of state. The wave composer (waves.ts)
// builds each wave off one keyed by the wave's number, so a wave plays the same each time
// it is reached while still varying wave to wave. The press's rolls and the crit roll draw
// at random on their own (sim.ts).
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
}
