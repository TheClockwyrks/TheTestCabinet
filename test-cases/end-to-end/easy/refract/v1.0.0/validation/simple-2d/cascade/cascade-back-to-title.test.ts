// Refract — cascade/cascade-back-to-title: back abandons the board and returns
// to the title.
//
// specs/modes/cascade.md "The sequence": `back` during `playing` abandons the
// board and returns to `title` with `CASCADE` highlighted (`menuIndex = 1`).
// That the sequence is really ENDED by it — a fresh one starting from tier 1
// afterwards — is cascade/cascade-restarts-fresh's point.
//
// The run being abandoned is one in progress: it is posed at five solves
// through `setSolvedCount` and `setTier` (specs/instrumentation.md), so the
// board left behind is a board of a run that has climbed. The board itself is
// posed through `loadBoard`, a board like any other, and `back` is the real
// Escape edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import { TIER_ADVANCE } from "../notation";
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

it("returns to title with CASCADE highlighted", async () => {
  await resetTo(h);
  poseCascadeRun(h, TIER_ADVANCE);
  await loadBoard(h, GEO_3X3);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "a board of the run in progress is up (precondition for the back edge)",
  );
  assertEqual(
    h.snapshot().solvedCount,
    TIER_ADVANCE,
    "five boards are recorded solved before backing out (precondition)",
  );

  // back during playing abandons the board and returns to title.
  await tapAction(h, "back");
  captureStill(h, "abandoned");
  assertEqual(
    h.snapshot().screen,
    "title",
    "back during playing returns to title (specs/modes/cascade.md)",
  );
  assertEqual(
    h.snapshot().menuIndex,
    1,
    "with CASCADE, the entry that led away, highlighted",
  );
});
