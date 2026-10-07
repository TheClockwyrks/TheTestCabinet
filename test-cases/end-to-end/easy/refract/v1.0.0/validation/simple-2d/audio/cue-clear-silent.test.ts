// Refract — audio/cue-clear-silent: clearing a board whose beams carry no
// segments emits nothing.
//
// The spec's edge: `clear` plays only when there was a segment to remove
// (specs/ui.md), and the clear action itself changes nothing on a board whose
// beams are already empty — so the tap below must raise no cue at all. The
// board is freshly posed, every beam empty; the key is the real `clear`
// binding (KeyR, specs/controls.md); and a stretch of frames runs after the
// tap so a cue played late would land in the watch too.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  tapAction,
  watchCues,
  type Harness,
} from "../harness";

/** Frames run after the tap, so a late cue is caught rather than missed. */
const SETTLE_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clear on a board with no segments plays no cue", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);
  assertEqual(
    h.snapshot().beams.triangle?.cells.length,
    0,
    "posing: the freshly posed board's beam carries no segments " +
      "(specs/instrumentation.md)",
  );

  const played = watchCues(h);
  await tapAction(h, "clear");
  await h.advance(SETTLE_FRAMES);
  captureStill(h, "silent");

  assertDeepEqual(
    played.map((cue) => cue.cue),
    [],
    "clearing a board whose beams carry no segments emits nothing " +
      "(specs/ui.md: clear plays only when there was a segment to remove)",
  );
});
