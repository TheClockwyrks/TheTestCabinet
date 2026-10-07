// Wireworm — screens/pause-resume: confirming RESUME returns to live play with
// the board untouched.
//
// specs/ui.md's `paused` menu: `RESUME`, the first entry of `PAUSE_ITEMS`,
// "Returns to `playing` with the board and the run exactly as they were." What
// is read back is the worm's tiles, because a build that treated a resume as a
// fresh start would have cleared or re-entered it.
//
// THE WORM IS POSED AS A MARKER, NOT AS A WALKER. Its step is gated off, so the
// only thing that could move it off its tiles is the resume itself — a stepping
// worm would step on the frame the confirm runs and this check would then be
// measuring the step clock instead of the resume. The step is
// `worm/step-cadence`'s requirement and is graded there.
//
// The highlight is posed on the first item rather than assumed to be there: the
// specification fixes what `RESUME` does and not where a fresh pause menu opens
// its highlight.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  poseWorm,
  requireWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { CONFIRM_KEY, pauseLiveBoard } from "./screens";

/** Which entry of `PAUSE_ITEMS` is `RESUME`. */
const RESUME_ITEM = PAUSE_ITEMS.indexOf("RESUME");

/** The worm posed as the board's marker: clear of every edge. */
const WORM_C = 12;
const WORM_R = 7;
const WORM_LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing with the worm on the tiles it was paused on", async () => {
  await startPlaying(h);
  const wormId = await poseWorm(h, {
    c: WORM_C,
    r: WORM_R,
    length: WORM_LENGTH,
    stepping: false,
  });
  await pauseLiveBoard(h, RESUME_ITEM);
  const atPause = requireWorm(await h.snapshot(), wormId);

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(resumed.screen, "playing", "the screen RESUME returned to");
  assertDeepEqual(
    requireWorm(resumed, wormId).segments,
    atPause.segments,
    "the worm's tiles after the resume",
  );
});
