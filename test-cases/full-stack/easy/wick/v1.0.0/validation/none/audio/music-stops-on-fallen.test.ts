// audio/music-stops-on-fallen — music is not looping on the frame after the run
// ends fallen.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`music` is looping
// on every frame exactly when `screen` is `playing`, `levelup`, `chest`, or
// `paused` ... and it stops on the frame the run ends, fallen or at dawn, or
// `back` on `paused` abandons it." `fallen` is on neither list of screens the
// loop runs on. specs/instrumentation.md fixes the frame the reading is taken on:
// "Both loops are reconciled from the state on every frame, so a state the debug
// surface posed sounds, one frame later, exactly as the same state reached by
// play." So the loop is read on the frame after the ending tick, which is the
// frame by which the specification has the state reconciled either way.
//
// HOW THE RUN IS ENDED. specs/world.md ("Fallen and dawn") ends a run at the end
// of a tick by the row "Fallen | `hp` is `0` or below. | `fallen`", and
// specs/instrumentation.md's `setHp(hp)` says "A value at or below `0` ends the
// run fallen at the end of the next `playing` tick". So health is posed at
// FALLEN_HP (`0`) and one tick is stepped. Dawn is far off, so the ending is the
// fallen one; the other ending is `audio/music-stops-on-dawn`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so nothing can heal the
// lamplighter back above `0` or move the screen anywhere else, and `recovery` is
// `BASE_RECOVERY` (`0`) with no Tinder held.
//
// WHY THE LOOP IS ESTABLISHED FIRST. Without it the check would pass on a build
// whose music never runs at all, which is a different build from one that fails
// to stop it. The loop is waited for on `playing` before the ending, one frame
// per crossing, and asserted; the wait is a drive length rather than a threshold,
// since a build loads and decodes its own produced `.wav` (specs/assets.md).
//
// THE TOLERANCE. None: a loop is running on the frame or it is not, and the frame
// is exact because the specification names it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  isLooping,
  type Harness,
} from "../harness";
import { openNight, stepUntilLoop } from "./cues";

/** The health posed: the boundary specs/world.md ends a run at, "`0` or below". */
const FALLEN_HP = 0;

/** Frames recorded on the end screen after the reading, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops music by the frame after the run ends fallen", async () => {
  await openNight(h);
  const running = await stepUntilLoop(h, "music");
  assertEqual(running, true, "music looping on playing before the ending");

  await h.debug.setHp(FALLEN_HP);
  const ended = await captureReplay(h, "stopped", async () => {
    const after = await h.step(1);
    await h.step(1);
    const looping = await isLooping(h, "music");
    await h.step(TRAIL_FRAMES);
    return { after, looping };
  });

  assertEqual(ended.after.screen, "fallen", "the screen the ending tick left");
  assertEqual(
    ended.looping,
    false,
    "music looping on the frame after the run ended fallen",
  );
});
