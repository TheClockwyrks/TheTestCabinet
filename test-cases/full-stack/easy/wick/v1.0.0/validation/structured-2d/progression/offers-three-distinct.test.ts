// Wick — progression/offers-three-distinct: an overlay over a pool of at least
// three presents exactly `OFFER_COUNT` distinct candidates.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The draw":
// "The overlay offers `OFFER_COUNT` distinct candidates drawn uniformly at
// random from the pool without replacement", with `OFFER_COUNT` (`3`).
// `specs/instrumentation.md`, the `pool` row: "`offers` is a subset of it
// except for the lamp-oil offer over an empty pool".
//
// THE POSE. Eight isolated `playing` runs, so eight draws are read rather
// than one. Each holds nothing, which leaves every base weapon and every
// passive a candidate: a pool of twenty, far above `OFFER_COUNT`, so the
// "pool smaller than `OFFER_COUNT`" clause never applies. Every driver switch
// is off, so nothing but the overlay's own draw happens on the opening tick.
// A build that offers two, four, or a repeated id fails on the first night it
// does it for.
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

/** Eight nights, so eight independent draws are read. */
const NIGHTS = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("presents three distinct offers from the pool on every night", async () => {
  for (let night = 1; night <= NIGHTS; night += 1) {
    isolate(h);
    const overlay = await openLevelUp(h, 1);

    assertEqual(
      overlay.screen,
      "levelup",
      `screen after the opening tick on night ${night}`,
    );
    assertGreaterThanOrEqual(
      overlay.run.pool.length,
      OFFER_COUNT,
      `run.pool size on night ${night}`,
    );
    assertLength(
      overlay.run.offers,
      OFFER_COUNT,
      `run.offers on night ${night} (specs/progression.md, The draw)`,
    );
    assertLength(
      [...new Set(overlay.run.offers)],
      OFFER_COUNT,
      `distinct ids among run.offers on night ${night}`,
    );
    for (const offer of overlay.run.offers) {
      assertContains(
        overlay.run.pool,
        offer,
        `offer ${offer} within run.pool on night ${night}`,
      );
    }
  }
  await h.frameDraw();
  captureStill(h, "offers");
});
