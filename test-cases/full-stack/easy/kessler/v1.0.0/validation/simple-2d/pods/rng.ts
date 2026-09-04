// pods/rng — the seeded pod stream, computed from the specification alone.
//
// specs/pods.md: "The game keeps one random stream for the whole session: a
// mulberry32 generator seeded with the session's seed", each draw "takes the
// stream's next value, a number in [0, 1)". The generator is named by the
// specification, so a check can PREDICT what a seeded scenario must shed and
// which seeds make the scenario it needs — never reading the expectation off
// the build under test.

import type { PodKind } from "../harness";
import { POD_DROP_CHANCE, POD_KIND_TABLE } from "../constants";

/**
 * The mulberry32 generator specs/pods.md fixes: seeded once, each call the
 * stream's next value in `[0, 1)`.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The kind the second draw value `u2` selects, per the specification's table. */
export function podKindFor(u2: number): PodKind {
  for (const band of POD_KIND_TABLE) {
    if (u2 >= band.from && u2 < band.to) return band.kind;
  }
  // u2 is in [0, 1) by construction; the table covers [0, 1).
  throw new Error(`no pod kind band holds ${u2}`);
}

/**
 * The pod each of the first `draws` destructions sheds under `seed`, in order,
 * `null` for a destruction that sheds nothing: each destruction consumes `u1`,
 * and a shedding one consumes `u2` as well, exactly as the draw states.
 */
export function podSequence(seed: number, draws: number): (PodKind | null)[] {
  const next = mulberry32(seed);
  const shed: (PodKind | null)[] = [];
  for (let i = 0; i < draws; i += 1) {
    const u1 = next();
    shed.push(u1 < POD_DROP_CHANCE ? podKindFor(next()) : null);
  }
  return shed;
}
