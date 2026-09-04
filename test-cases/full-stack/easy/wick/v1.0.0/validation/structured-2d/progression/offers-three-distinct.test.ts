// Wick — progression/offers-three-distinct: an overlay over a pool of at least
// three presents exactly `OFFER_COUNT` distinct candidates.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The draw":
// "The overlay offers `OFFER_COUNT` distinct candidates drawn uniformly at
// random from the pool without replacement", with `OFFER_COUNT` (`3`).
// `specs/instrumentation.md`, the `pool` row: "`offers` is a subset of it
// except for the lamp-oil offer over an empty pool".
//
// THE POSE. Eight isolated `playing` runs, each laid with a different seed, so
// eight different draws are read rather than one. Each holds nothing, which
// leaves every base weapon and every passive a candidate: a pool of twenty,
// far above `OFFER_COUNT`, so the "pool smaller than `OFFER_COUNT`" clause
// never applies. Every driver switch is off, so no tick draws from the
// generator before the overlay's own draw. A build that offers two, four, or a
// repeated id fails on the first seed it does it for.
//
// THE TOLERANCE. Exact: a list length, a distinct-id count, and membership.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Eight seeds, so eight independent draws are read. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("presents three distinct offers from the pool on every seed", async () => {
  for (const seed of SEEDS) {
    isolate(h, { seed });
    const overlay = await openLevelUp(h, 1);

    assertEqual(
      overlay.screen,
      "levelup",
      `screen after the opening tick on seed ${seed}`,
    );
    assertGreaterThanOrEqual(
      overlay.run.pool.length,
      OFFER_COUNT,
      `run.pool size on seed ${seed}`,
    );
    assertLength(
      overlay.run.offers,
      OFFER_COUNT,
      `run.offers on seed ${seed} (specs/progression.md, The draw)`,
    );
    assertLength(
      [...new Set(overlay.run.offers)],
      OFFER_COUNT,
      `distinct ids among run.offers on seed ${seed}`,
    );
    for (const offer of overlay.run.offers) {
      assertContains(
        overlay.run.pool,
        offer,
        `offer ${offer} within run.pool on seed ${seed}`,
      );
    }
  }
  await h.frameDraw();
  captureStill(h, "offers");
});
