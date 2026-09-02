// Wick — progression/offers-vary-with-seed: the three offers are drawn at
// random rather than fixed.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The draw":
// "The overlay offers `OFFER_COUNT` distinct candidates drawn UNIFORMLY AT
// RANDOM from the pool without replacement, using the game's seeded random
// generator", and "`offers` holds the drawn ids in the order they are listed".
// `specs/instrumentation.md`, `reset(options)`: "`options.seed` seeds the
// generator", so two runs laid with different seeds draw independently.
//
// THE POSE. Ten isolated `playing` runs over the same pool, differing only in
// the seed each is laid with: each holds nothing, so each pool is the same
// twenty candidates. Every driver switch is off, so nothing between the seeding
// and the draw consumes the generator. A build that always presents the first
// three of the pool, or any fixed triple, reads one distinct result across the
// ten and fails.
//
// THE TOLERANCE. Two of the ten differing is enough, and no more is claimed: a
// uniform draw of three from twenty repeats a whole triple in order with
// probability `1/6840` per pair, so ten identical draws from a conforming build
// is far beyond negligible while one repeat proves nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Ten seeds over one pool. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("does not present the same three ids in the same order on all ten seeds", async () => {
  const drawn: string[] = [];
  let poolSize = 0;
  for (const seed of SEEDS) {
    isolate(h, { seed });
    const overlay = await openLevelUp(h, 1);
    assertEqual(
      overlay.screen,
      "levelup",
      `screen after the opening tick on seed ${seed}`,
    );
    poolSize = overlay.run.pool.length;
    drawn.push(overlay.run.offers.join(","));
  }
  await h.frameDraw();
  captureStill(h, "random");

  assertEqual(poolSize, 20, "the pool the ten draws were made over");
  assertGreaterThanOrEqual(
    new Set(drawn).size,
    2,
    "distinct offer lists across ten seeds (specs/progression.md, The draw)",
  );
});
