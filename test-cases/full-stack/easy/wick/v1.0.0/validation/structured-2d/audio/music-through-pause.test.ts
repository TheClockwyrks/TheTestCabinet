// Wick — audio/music-through-pause: the bed keeps looping while the run is
// paused.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused`. It starts on the frame a fresh run starts and keeps
// playing through the overlays and the pause". `paused` is one of the four
// screens the rule names, and "on every frame" is what makes the reading a
// whole span rather than one sample: the threshold is `true` on every frame
// of the pause.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with the bed already up
// (the frame `isolatedRun` spends is the one the loops are reconciled on),
// then `paused` posed. `specs/instrumentation.md` makes that pose the real
// pause: "`paused` from `playing`: Exactly as `pause` does; the accumulator
// is discarded as on any frame that leaves `playing`." Posing it keeps the
// `pause` key out of an audio point, so a build with a broken binding fails
// the control points and is decided here on its audio alone.
//
// The pause is then held for `FRAMES` frames with no key pressed, so nothing
// resumes or abandons it. `specs/ui.md` says nothing advances under it, so
// the only thing those frames can change is the bed, which is what is read.
//
// THE TOLERANCE. None: "on every frame" admits no gap, and the reading is a
// boolean. `FRAMES` (60, one second of frames) is a drive length rather than
// a threshold.

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

/** One second of frames under the pause. */
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has music looping on every frame of paused", async () => {
  await isolatedRun(h);
  assertEqual(
    h.looping(CUES.music),
    true,
    "whether the bed was up on playing before the pause",
  );

  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the pause left");

  const trace = await captureReplay(h, "paused", () =>
    loopTrace(h, CUES.music, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen the pause held for the whole span",
  );
  assertEqual(
    trace.filter((looping) => !looping).length,
    0,
    `frames of the pause on which music was not looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
