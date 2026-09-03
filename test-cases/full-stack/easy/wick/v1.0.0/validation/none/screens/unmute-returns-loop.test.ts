// screens/unmute-returns-loop — unmuting returns the loop in place, without
// restarting it.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "Muting silences a
// running loop without stopping it, and the loop returns in place when
// unmuted." specs/ui.md ("The loops"): "A looping cue sounds through a single
// source set to loop, from the frame that starts it until the frame that stops
// it, playing its file end to end with no gap; a cue is either looping or not,
// so starting one that is already looping changes nothing." So a bed that was
// running before a mute is the SAME source after the unmute: no second `music`
// sound is emitted, and the one that was running is still looping.
//
// WHY THE WORLD IS POSED AS IT IS. The build's audio is armed with a real
// browser gesture first, on a key bound to nothing. An isolated night is opened
// and one frame run, since "Both loops are reconciled from the state on every
// frame", and the bed is read as running before anything is pressed. The
// named-cue log is attached only THEN, so that what it collects is what the
// mute and the unmute produced rather than the start the run itself made. Both
// presses are REAL `KeyM` keys held across one frame each.
//
// THE TOLERANCE. None: `muted`, whether a source is looping, and the count of
// `music` sounds emitted across the two presses are all exact readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  cuesNamed,
  isLooping,
  pressMute,
  watchNamedCues,
  type Harness,
} from "../harness";
import { night } from "./stage";

/** The cue the bed plays under, one of the two in `LOOPING_CUES`. */
const MUSIC = "music";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the bed still looping and never restarted after KeyM twice", async () => {
  await h.armAudio();
  const playing = await night(h);
  assertEqual(playing.muted, false, "muted before the presses");
  await h.step(1);
  assertTrue(await isLooping(h, MUSIC), "the bed looping before the presses");

  const heard = await watchNamedCues(h);
  const muted = await pressMute(h);
  assertEqual(muted.muted, true, "muted after the first KeyM");
  const unmuted = await pressMute(h);
  await captureStill(h, "returned");

  assertEqual(unmuted.muted, false, "muted after the second KeyM");
  assertTrue(await isLooping(h, MUSIC), "the bed still looping once unmuted");
  assertLength(
    cuesNamed(heard, MUSIC),
    0,
    "music sounds started across the mute and the unmute",
  );
});
