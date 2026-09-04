// audio/hum-starts-on-resume — with Halo held, hum is not looping on paused and
// is looping on the frame after play resumes.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`hum` is looping on
// every frame exactly when `screen` is `playing` and a held weapon is `halo` or
// `corona`. It starts on the frame that first makes both true, whether Halo was
// just acquired or play just resumed from an overlay or a pause, and it stops on
// the frame either stops being true." A pause makes the screen condition false
// with the loadout unchanged, so the hum is off there, and the resume makes both
// true again. specs/instrumentation.md fixes the frame each reading is taken on:
// "Both loops are reconciled from the state on every frame, so a state the debug
// surface posed sounds, one frame later, exactly as the same state reached by
// play."
//
// WHY THE PAUSE AND THE RESUME ARE POSED. specs/instrumentation.md defines both
// poses to be the played transitions: `setScreen("paused")` from `playing` is
// "Exactly as `pause` does", and `setScreen("playing")` from `paused` "Resumes
// exactly as `pause` on `paused` does; the run is untouched." A key press would
// put the pause control's own correctness between this point and the loop it
// reads, and that control is `controls/`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held but the Halo this point needs,
// so nothing on any frame can move the screen, end the run, or open an overlay.
// `weaponFire` stays off, so the aura pulses nothing and no other cue rides on
// the frames the loop is read.
//
// THE HUM IS ESTABLISHED ON `playing` FIRST, so the reading on `paused` is of a
// loop that stopped rather than of one that never started. That it starts on
// acquisition is `audio/hum-starts-on-acquire`'s point; here it is a
// precondition.
//
// THE TOLERANCE. None: a loop is running on a frame or it is not, and each frame
// is exact because the specification names it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isLooping,
  type Harness,
} from "../harness";
import { openNight } from "./cues";

/** Frames recorded after the reading, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("has no hum on paused and the hum back on the frame after play resumes", async () => {
  await openNight(h);
  await holdWeapon(h, "halo");
  await h.step(1);
  assertEqual(
    await isLooping(h, "hum"),
    true,
    "the hum looping on playing with Halo held, before the pause",
  );

  const resumed = await captureReplay(h, "resumed", async () => {
    await h.debug.setScreen("paused");
    const paused = await h.step(1);
    const onPause = await isLooping(h, "hum");

    await h.debug.setScreen("playing");
    const playing = await h.step(1);
    const onResume = await isLooping(h, "hum");
    await h.step(TRAIL_FRAMES);
    return { paused, onPause, playing, onResume };
  });

  assertEqual(resumed.paused.screen, "paused", "the screen the pause posed");
  assertEqual(
    resumed.onPause,
    false,
    "the hum looping on the frame after the pause",
  );
  assertEqual(
    resumed.playing.screen,
    "playing",
    "the screen the resume returned to",
  );
  assertEqual(
    resumed.onResume,
    true,
    "the hum looping on the frame after play resumed",
  );
});
