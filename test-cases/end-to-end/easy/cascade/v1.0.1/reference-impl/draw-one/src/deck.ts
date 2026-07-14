// Cascade — the deck: construction and a genuinely random shuffle.
//
// The shuffle is seeded from the platform CSPRNG (`crypto.getRandomValues`), not
// `Math.random`, so no two deals are alike and the deal is not predictable
// (specs/rules.md).

import type { Card } from "./types";
import { SUITS } from "./types";

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

// A uniform integer in [0, max) drawn from the CSPRNG, using rejection sampling
// so the result is unbiased.
function randInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

// Fisher–Yates shuffle in place, using the unbiased CSPRNG index above.
export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
