// cascade/cascade-restarts-fresh — starting Cascade again begins a fresh
// sequence.
//
// specs/modes/cascade.md "The sequence": backing out of `playing` ends the
// sequence, "starting Cascade again begins a fresh one from tier `1`" — and
// entry itself sets `solvedCount` to 0. That `back` reaches the title at all is
// cascade/cascade-back-to-title's point; here the subject is what the NEXT run
// starts from.
//
// The run being abandoned is one in progress: it is posed at five solves
// through `setSolvedCount` and `setTier` (specs/instrumentation.md), so it
// stands at solvedCount 5 and tier 2 and "fresh" afterwards is distinguishable
// from "the run that was left". The board it is left on is posed through
// `loadBoard`, a board like any other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import { TIER_ADVANCE, tierForSolvedCount } from "../notation";
import {
  captureStill,
  createHarness,
  fireAction,
  loadBoard,
  poseCascadeRun,
  startCascade,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("re-entering after a back starts from solvedCount 0 and tier 1", async () => {
  await poseCascadeRun(h, TIER_ADVANCE);
  await loadBoard(h, GEO_3X3);
  const abandoned = await h.snapshot();
  assertEqual(abandoned.screen, "playing", "precondition: a board in play");
  assertEqual(
    abandoned.solvedCount,
    TIER_ADVANCE,
    "precondition: five boards solved in the run being abandoned",
  );
  assertEqual(
    abandoned.tier,
    tierForSolvedCount(TIER_ADVANCE),
    "precondition: the run being abandoned has climbed past tier 1",
  );

  await fireAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "precondition: back reaches the title (see cascade-back-to-title)",
  );

  // Starting Cascade again begins a fresh sequence.
  await startCascade(h);
  await captureStill(h, "fresh");
  const fresh = await h.snapshot();
  assertEqual(fresh.screen, "playing", "re-entering puts a board in play");
  assertEqual(fresh.solvedCount, 0, "a fresh sequence: solvedCount");
  assertEqual(fresh.tier, 1, "a fresh sequence: tier");
});
