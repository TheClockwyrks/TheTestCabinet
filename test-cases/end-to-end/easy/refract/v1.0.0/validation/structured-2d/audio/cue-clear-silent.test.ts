// Refract — audio/cue-clear-silent: clearing a board whose beams carry no
// segments emits nothing.
//
// specs/ui.md's edge on the clear cue: "`clear` plays only when there was a
// segment to remove". So the same real key press that audio/cue-clear proves
// noisy over a drawn segment — `clear` is bound to KeyR (specs/controls.md) —
// is fired here over a freshly posed board whose every beam is empty, and no
// clear cue may arrive on that frame or any frame after it. The board is
// asserted empty before the press and still empty after, so the silence is
// the rule's and not a press that never landed. The still is the empty board
// the clear was fired on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CUES } from "../constants";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  clearCues,
  createHarness,
  cuesNamed,
  loadBoard,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** Frames watched after the press for a cue that must never arrive. */
const TAIL_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits no clear cue when the beams carry no segments", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [],
    "the posed board's beam is empty before the clear",
  );

  clearCues(h);
  // The clear action's own key, pressed for real on the empty board, and a
  // stretch of frames after it for a late cue to show up in.
  await tapAction(h, "clear");
  await h.advance(TAIL_TICKS);
  captureStill(h, "silent");

  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [],
    "the board is still empty after the clear",
  );
  assertEqual(
    cuesNamed(h, CUES.clear).length,
    0,
    "no clear cue plays when there was no segment to remove",
  );
});
