// progression/offers-vary-with-seed — the draw is random, so overlays opened
// over one pool from ten seeds do not all present the same three ids in the
// same order.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The draw: "The overlay offers
// OFFER_COUNT distinct candidates drawn uniformly at random from the pool
// without replacement, using the game's seeded random generator ... offers
// holds the drawn ids in the order they are listed."
// specs/instrumentation.md, A deterministic core: "The game holds one
// pseudo-random generator, seeded by reset ... and every random draw comes from
// it: a spawn's angle and type, an offer draw", and "Given the same seed, the
// same sequence of operations, and the same number of ticks, the game reaches
// the same run ... every time", so a different seed is the one thing changed
// between these ten nights.
//
// THE POSE. Ten isolated nights, one per seed, each with nothing on the field,
// nothing held, and every driver switch off, so the pool is the same twenty
// candidates every time and the offer draw is the only reader of the
// generator. Each overlay is opened the real way, by queueing a level-up and
// running the playing tick that ends with it queued, and the three ids are read
// in the order the snapshot lists them.
//
// THE TOLERANCE. The reading is that the ten are not all one list, not that any
// two named seeds differ: a generator that happens to repeat a draw on two of
// the ten still passes. A build that offers a fixed three, the first three of
// the pool among them, presents one list ten times and fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Ten seeds, spread across the whole domain reset accepts. */
const SEEDS = [
  0, 1, 7, 42, 1009, 65535, 123457, 999983, 2147483647, 4294967295,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("does not present one list of three from all ten seeds", async () => {
  const drawn: string[] = [];
  for (const seed of SEEDS) {
    isolate(h, { seed });

    const overlay = await openLevelUp(h, 1);

    assertEqual(
      overlay.screen,
      "levelup",
      `the overlay opened at seed ${seed}`,
    );
    assertEqual(
      overlay.run.offers.length,
      OFFER_COUNT,
      `three at seed ${seed}`,
    );
    drawn.push(overlay.run.offers.join(","));
  }
  captureStill(h, "random");

  assertGreaterThan(
    new Set(drawn).size,
    1,
    `the distinct draws over ten seeds (${drawn.join(" | ")})`,
  );
});
