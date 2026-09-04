// Wick — audio/music-stops-on-abandon: the bed stops when a paused run is
// abandoned.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused` ... and it stops on the frame the run ends, fallen or
// at dawn, or `MAIN MENU` on `paused` abandons it. `title`, `howto`, and
// `almanac` carry no music." `MAIN MENU` is the second of `PAUSE_ITEMS` and
// "Abandons the run and returns to `title` with `menuIndex = 0`"
// (`specs/ui.md`, `paused`). The abandon lands on `title`, which is not one of
// the four screens the rule names, so the threshold is `false` on every frame
// of it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with the bed already up
// (the frame `isolatedRun` spends is the one the loops are reconciled on),
// read as `true` on `playing`, so what this point decides is a STOP and not a
// bed that never started. Then `paused` posed, which is where the abandon is
// reached from, and then `title` posed, which `specs/instrumentation.md`
// makes exactly the abandon: "`title` from any: Discards the run exactly as
// `TITLE` on an end screen or `MAIN MENU` on `paused` does: the idle run."
// Posing both keeps the pause menu and its keys out of an audio point, so a
// build that cannot reach or work that menu fails the screen points and is
// decided here on its audio alone.
//
// The bed is read on `playing` rather than on `paused`, so that a build which
// wrongly drops the bed under the pause fails `music-through-pause`, which is
// that requirement's own point, and is still decided here on what the abandon
// leaves behind.
//
// The title is then held for `FRAMES` frames with no key pressed, so nothing
// lights the lamp again. `specs/instrumentation.md` reconciles the loops "by
// the next frame", which is the latitude the reading below grants: the trace
// starts at the frame after the abandon.
//
// THE TOLERANCE. One frame for the reconciliation, which the specification
// itself grants, and no gap after it. The reading is a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { isolatedRun, loopTrace } from "./cues";

/** Frames read after the abandon: the reconciling frame and a second of them. */
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has music not looping on the frames after a paused run is abandoned", async () => {
  await isolatedRun(h);
  assertEqual(
    h.looping(CUES.music),
    true,
    "whether the bed was up on playing before the run was paused",
  );
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the pause left");
  await h.advance(1);

  const abandoned = poseScreen(h, "title");
  assertEqual(
    abandoned.screen,
    "title",
    "the screen the abandon left (specs/instrumentation.md, setScreen)",
  );

  const trace = await captureReplay(h, "stopped", () =>
    loopTrace(h, CUES.music, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the title held for the whole span",
  );
  assertEqual(
    trace.filter((looping) => looping).length,
    0,
    `frames of the title on which music was still looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
