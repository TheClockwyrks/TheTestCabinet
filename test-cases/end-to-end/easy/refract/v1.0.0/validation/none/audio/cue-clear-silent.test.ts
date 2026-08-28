// Refract — audio/cue-clear-silent: clearing a board whose beams carry no
// segments emits nothing.
//
// specs/ui.md: "`clear` plays only when there was a segment to remove." A build
// that blips on every press of the clear key fails exactly this. The board is
// posed with every beam empty (`loadBoard` — specs/instrumentation.md), the key
// is really pressed, and the window around it must be silent both ways the
// harness can hear: no sound attributed to any driven frame (`watchCues`), and
// no sound at all across the window (`sounds()`, which also counts an emission
// a build makes from the key's event handler, outside any frame).
//
// The sibling point, audio/cue-clear, holds the other half of the rule: with a
// segment to remove, the same key press must sound.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  fireAction,
  loadBoard,
  watchCues,
  type Harness,
} from "../harness";

/** Half a second driven after the clear, so a late blip is still caught. */
const SETTLE_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("emits nothing when the clear finds no segment to remove", async () => {
  await loadBoard(h, GEO_3X3);
  await h.armAudio();

  // The precondition the rule turns on: every beam is empty.
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "loadBoard moves to playing");
  assertDeepEqual(
    before.beams.triangle?.cells,
    [],
    "the posed board's beam carries no segments",
  );

  const played = watchCues(h);
  const totalBefore = await h.sounds();
  await fireAction(h, "clear");
  await h.advance(SETTLE_TICKS);
  const totalAfter = await h.sounds();
  await captureStill(h, "silent");

  assertEqual(played.length, 0, "no sound on the clear frame or after it");
  assertEqual(
    totalAfter - totalBefore,
    0,
    "no sound anywhere across the clear, frames or not",
  );
});
