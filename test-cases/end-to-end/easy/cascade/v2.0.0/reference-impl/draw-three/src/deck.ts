// Cascade — the deck: construction, a seedable generator, and the shuffle.
//
// The shuffle draws its indices from a supplied generator. Normal play passes a
// generator seeded from the platform CSPRNG (`cryptoRng`), so no two deals are
// alike and the deal is not predictable (specs/rules.md). A caller that wants a
// repeatable board seeds a `mulberry32` generator explicitly and passes it in
// (specs/instrumentation.md).

import type { Card } from "./types";
import { SUITS } from "./types";

// A generator of floats in [0, 1). Both the deal shuffle and the victory
// cascade's launch velocities draw from one of these.
export type Rng = () => number;

// mulberry32: a small, fast, seedable PRNG. Seeding it with a fixed number and
// replaying the same draws reproduces the same sequence exactly, which is what
// makes a seeded scenario deterministic (specs/instrumentation.md).
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normal play's non-deterministic source: a [0, 1) float drawn from the platform
// CSPRNG, so each new game's deal is genuinely random and unpredictable.
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
};

// A fresh, ordered 52-card deck, all face-down.
export function makeDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      cards.push({ suit, rank, faceUp: false, id: id++ });
    }
  }
  return cards;
}

// Fisher–Yates shuffle in place, drawing each index from the supplied generator.
export function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
