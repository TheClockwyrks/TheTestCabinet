// Deepcore — the deterministic generator, as a value.
//
// `specs/instrumentation.md` requires that reseeding and replaying the same
// calls reproduce the same mine exactly, so the generator's whole state has to
// live in the game's state rather than in an object beside it. That state is a
// single 32-bit word, and every draw below is a pure function from that word to
// the next one and the value drawn — mulberry32, which is small, fast, and
// well-distributed enough for scattering rock.
//
// A caller threads the word through: `const [f, next] = nextFloat(seed)`. The
// generation code takes a `Draw` cursor so a long sequence of draws reads as
// ordinary statements rather than as a chain of tuples; the cursor holds nothing
// but that one word and hands it back at the end.

/** One draw: the value, and the generator state that follows it. */
export type Draw<T> = readonly [T, number];

/** The next float in `[0, 1)`, and the state that follows it. */
export function nextFloat(state: number): Draw<number> {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * A cursor over the generator, for a run of draws that belongs to one operation.
 *
 * It is a local, short-lived holder for the one word the generator is: an
 * operation opens a cursor on the state it was handed, draws from it, and writes
 * `cursor.state` back. Nothing keeps one across a frame.
 */
export class Draws {
  constructor(public state: number) {}

  /** A float in `[0, 1)`. */
  float(): number {
    const [value, next] = nextFloat(this.state);
    this.state = next;
    return value;
  }

  /** A float in `[min, max)`. */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** A whole number in `[min, maxInclusive]`. */
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** One item, uniformly. */
  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.float() * items.length)];
    if (item === undefined) throw new Error("Deepcore: pick() from no items");
    return item;
  }

  /** One item, with `items[i]` drawn at `weights[i] / sum(weights)`. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const weight of weights) total += weight;
    let r = this.float() * total;
    for (let i = 0; i < items.length; i += 1) {
      r -= weights[i] ?? 0;
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}
