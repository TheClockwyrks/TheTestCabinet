// cascade/cascade-back-to-title — back abandons the board and returns to the
// title.
//
// specs/modes/cascade.md "The sequence": "`back` during `playing` abandons the
// board and returns to `title` with `CASCADE` highlighted (`menuIndex = 1`)".
// That the sequence is really ENDED by it — a fresh one starting from tier 1
// afterwards — is cascade/cascade-restarts-fresh's point.
//
// The run being abandoned is one in progress: it is posed at five solves
// through `setSolvedCount` and `setTier` (specs/instrumentation.md), so the
// board left behind is a board of a run that has climbed. The board itself is
// posed through `loadBoard`, a board like any other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import { TIER_ADVANCE } from "../notation";
import {
  captureStill,
  createHarness,
  fireAction,
  loadBoard,
  poseCascadeRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("back during playing returns to title with CASCADE highlighted", async () => {
  await poseCascadeRun(h, TIER_ADVANCE);
  await loadBoard(h, GEO_3X3);
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "precondition: a run in progress");
  assertEqual(
    playing.solvedCount,
    TIER_ADVANCE,
    "precondition: five boards solved",
  );

  // back abandons the board.
  await fireAction(h, "back");
  await captureStill(h, "abandoned");
  const abandoned = await h.snapshot();
  assertEqual(
    abandoned.screen,
    "title",
    "back during playing returns to title",
  );
  assertEqual(
    abandoned.menuIndex,
    1,
    "with CASCADE, the entry that led away, highlighted",
  );
});
