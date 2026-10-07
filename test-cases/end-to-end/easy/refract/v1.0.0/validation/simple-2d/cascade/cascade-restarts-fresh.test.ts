// Refract — cascade/cascade-restarts-fresh: starting Cascade again begins a
// fresh sequence.
//
// specs/modes/cascade.md "The sequence": backing out of `playing` ends the
// sequence, and starting Cascade again begins a fresh one from tier 1 — entry
// itself sets `solvedCount` to 0. That `back` reaches the title at all is
// cascade/cascade-back-to-title's point; here the subject is what the NEXT run
// starts from.
//
// To make the freshness observable, the run being abandoned is posed at five
// solves through `setSolvedCount` and `setTier` (specs/instrumentation.md), so
// it stands at solvedCount 5 and tier 2 rather than the 0 and 1 a fresh
// sequence would show anyway. The board it is left on is posed through
// `loadBoard`, a board like any other; the re-entry goes through the
// registered actions, and `back` is the real Escape edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import { TIER_ADVANCE, tierForSolvedCount } from "../notation";
import {
  captureStill,
  createHarness,
  loadBoard,
  poseCascadeRun,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

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
  assertEqual(abandoned.screen, "playing", "precondition: a board in play");
  assertEqual(
    abandoned.solvedCount,
    TIER_ADVANCE,
    "five boards are recorded solved before backing out (precondition)",
  );
  assertEqual(
    abandoned.tier,
    tierForSolvedCount(TIER_ADVANCE),
    "the run being abandoned has climbed past tier 1 (precondition)",
  );

  await tapAction(h, "back");
  assertEqual(
    h.snapshot().screen,
    "title",
    "precondition: back reaches the title (see cascade-back-to-title)",
  );

  // Starting Cascade again begins a fresh sequence. The return already
  // highlights CASCADE, so a plain `confirm` takes it.
  await tapAction(h, "confirm");
  const fresh = h.snapshot();
  captureStill(h, "fresh");
  assertEqual(
    fresh.screen,
    "playing",
    "choosing CASCADE again puts a board in play (specs/modes/cascade.md)",
  );
  assertEqual(
    fresh.solvedCount,
    0,
    "the new sequence starts from solvedCount 0",
  );
  assertEqual(fresh.tier, 1, "the new sequence starts from tier 1");
});
