// audio/music-silent-on-howto — no music loops on any frame of the how-to
// screen.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`music` is looping
// on every frame exactly when `screen` is `playing`, `levelup`, `chest`, or
// `paused`", and, plainly, "`title` and `howto` carry no music." "Exactly when"
// makes the how-to screen's silence a requirement rather than an absence, and "on
// every frame" is why this reads every frame of a stretch rather than one.
//
// WHY THE MUSIC IS RUNNING FIRST. A silence is only a reading if the build has
// something to be silent about: a build with no music at all would pass a bare
// silent stretch while failing every other music point, and the stretch would
// have decided nothing. So the run is opened first and the loop is waited for and
// asserted on `playing`, and only then is the how-to screen entered — which also
// makes this the stronger reading, of a bed that was running and had to stop
// rather than of one that was never asked for.
//
// WHY THE SCREEN IS POSED. specs/instrumentation.md defines the pose to be the
// played transition: `setScreen("howto")` from any screen "Enters the how-to
// screen exactly as confirming `HOW TO PLAY` does: the idle run." A key press
// would put the title menu's own correctness between this point and the loop it
// reads, and that menu is `audio/cue-menu-confirm`'s and `screens/`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night before the transition: every
// driver switch off, nothing alive, nothing dropped, and no slot held, so nothing
// can end the run or open an overlay on the way. No key is pressed during the
// stretch, so the screen holds, which is read on every frame to confirm;
// specs/ui.md advances "Nothing" on `howto`.
//
// THE TOLERANCE. None: a loop is running on a frame or it is not, and
// HOWTO_FRAMES (`60`, one second) is a drive length that decides nothing beyond
// being long enough that a build whose bed lingers into the screen is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { loopOverFrames, openNight, stepUntilLoop } from "./cues";

/** One second of the how-to screen, read a frame at a time. */
const HOWTO_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("loops no music on any frame of the how-to screen", async () => {
  await openNight(h);
  const running = await stepUntilLoop(h, "music");
  assertEqual(
    running,
    true,
    "music looping on playing, so the how-to screen's silence is a reading",
  );

  const howto = await poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "the screen the transition entered");

  const frames = await captureReplay(h, "silent", () =>
    loopOverFrames(h, "music", HOWTO_FRAMES),
  );

  assertLength(frames, HOWTO_FRAMES, "the frames of the how-to screen read");
  for (const frame of frames) {
    assertEqual(
      frame.screen,
      "howto",
      `the screen on frame ${frame.frame} of the how-to screen`,
    );
    assertEqual(
      frame.sources,
      0,
      `the music sources looping on frame ${frame.frame} of the how-to screen`,
    );
  }
});
