// Refract — cascade/cascade-restarts-fresh: starting Cascade again begins a
// fresh sequence.
//
// specs/modes/cascade.md "The sequence": backing out of playing ends the
// sequence, and starting Cascade again begins a fresh one from tier 1 — entry
// itself sets solvedCount to 0. That `back` reaches the title at all is
// cascade/cascade-back-to-title's point; here the subject is what the NEXT run
// starts from.
//
// The run being abandoned is posed at TIER_ADVANCE solves through
// `setSolvedCount` and `setTier` (specs/instrumentation.md), so solvedCount
// is 5 and the tier has climbed and a fresh sequence is distinguishable from
// a continued one. The board it is left on is posed through `loadBoard`, a
// board like any other; then `back` is pressed and CASCADE is chosen again
// through the real title menu — the return already highlights the entry that
// led away, so a plain `confirm` takes it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  poseCascadeRun,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";
import { TIER_ADVANCE, tierForSolvedCount } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-entering after a back starts from solvedCount 0 and tier 1", async () => {
  await resetTo(h);
  poseCascadeRun(h, TIER_ADVANCE);
  await loadBoard(h, GEO_3X3);
  const abandoned = h.snapshot();
  assertEqual(abandoned.screen, "playing", "a board of the run is up");
  assertEqual(
    abandoned.solvedCount,
    TIER_ADVANCE,
    "progress stands before back",
  );
  assertEqual(
    abandoned.tier,
    tierForSolvedCount(TIER_ADVANCE),
    "the run being abandoned has climbed past tier 1",
  );

  await tapAction(h, "back");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "title",
    "precondition: back reaches the title (see cascade-back-to-title)",
  );

  // Start Cascade again: the return already highlights CASCADE, so confirm
  // takes it.
  await tapAction(h, "confirm");
  await h.advance(1);
  // The fresh sequence after backing out.
  captureStill(h, "fresh");

  const fresh = h.snapshot();
  assertEqual(fresh.screen, "playing", "Cascade starts again on playing");
  assertEqual(fresh.mode, "cascade", "the restarted mode is cascade");
  assertEqual(
    fresh.solvedCount,
    0,
    "the fresh sequence starts at solvedCount 0",
  );
  assertEqual(fresh.tier, 1, "the fresh sequence starts at tier 1");
});
