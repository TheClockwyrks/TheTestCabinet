// instrumentation/rng — the seeded pod stream, PREDICTED from the specification
// rather than read off the build.
//
// specs/pods.md fixes the stream exactly: "The game keeps one random stream for
// the whole session: a mulberry32 generator seeded with the session's seed",
// "each draw takes the stream's next value, a number in `[0, 1)`", "the
// destruction takes the stream's next value `u1`. At `u1 < 0.25` it sheds a pod
// and takes a second value `u2` for the kind; at `u1 >= 0.25` it sheds nothing",
// with the `u2` kind table specs/pods.md states. Because the algorithm, the
// consumption rule, and the table are all the specification's own figures, a
// point about the GENERATOR — that an operation did or did not consume it — can
// compute what a seeded session must shed and compare the build against that,
// never against the reference implementation.

import { POD_DROP_CHANCE, POD_KIND_TABLE } from "../constants";
import type { PodKind } from "../harness";

/**
 * The mulberry32 generator specs/pods.md names: seeded once, each call the
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

/** The kind the second draw value `u2` selects, per the table. */
export function podKindFor(u2: number): PodKind {
  for (const band of POD_KIND_TABLE) {
    if (u2 < band.upTo) return band.kind;
  }
  return POD_KIND_TABLE[POD_KIND_TABLE.length - 1].kind;
}

/**
 * The pod each of the first `draws` destructions sheds under `seed`, in order:
 * `null` for a destruction that sheds nothing. Each draw consumes `u1`, and a
 * shedding one consumes `u2` as well, exactly as specs/pods.md states.
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
