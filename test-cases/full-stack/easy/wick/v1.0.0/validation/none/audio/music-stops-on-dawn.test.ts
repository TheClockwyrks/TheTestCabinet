// audio/music-stops-on-dawn — music is not looping on the frame after the run
// ends at dawn.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`music` is looping
// on every frame exactly when `screen` is `playing`, `levelup`, `chest`, or
// `paused` ... and it stops on the frame the run ends, fallen or at dawn, or
// `back` on `paused` abandons it." `dawn` is on neither list of screens the loop
// runs on. specs/instrumentation.md fixes the frame the reading is taken on:
// "Both loops are reconciled from the state on every frame, so a state the debug
// surface posed sounds, one frame later, exactly as the same state reached by
// play." So the loop is read on the frame after the ending tick.
//
// HOW THE RUN IS ENDED. specs/world.md ("Fallen and dawn"): "`DAWN_TIME` (`600`)
// seconds is the length of the night", by the row "Dawn | `tick` equals
// `DAWN_TIME x TICK_HZ` (`36000`). | `dawn`". So the clock is posed to
// `MAX_POSED_TICK` (`35999`), the greatest value specs/instrumentation.md's
// `setTick` accepts, and the one stepped tick after it is the ending. The
// lamplighter keeps the `BASE_MAX_HP` (`100`) a fresh run starts at and nothing
// can take any of it, so the run cannot end fallen instead; that ending is
// `audio/music-stops-on-fallen`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so nothing hurts the
// lamplighter, nothing spawns, and no overlay can open before the ending tick.
//
// WHY THE LOOP IS ESTABLISHED FIRST. Without it the check would pass on a build
// whose music never runs at all, which is a different build from one that fails
// to stop it. The loop is waited for on `playing` before the clock is posed, one
// frame per crossing, and asserted; the wait is a drive length rather than a
// threshold, since a build loads and decodes its own produced `.wav`
// (specs/assets.md).
//
// THE TOLERANCE. None: a loop is running on the frame or it is not, and the frame
// is exact because the specification names it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK, MAX_POSED_TICK, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  isLooping,
  type Harness,
} from "../harness";
import { openNight, stepUntilLoop } from "./cues";

/** Frames recorded on the end screen after the reading, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("stops music by the frame after the run ends at dawn", async () => {
  await openNight(h);
  const running = await stepUntilLoop(h, "music");
  assertEqual(running, true, "music looping on playing before the ending");

  await h.debug.setTick(MAX_POSED_TICK);
  const ended = await captureReplay(h, "stopped", async () => {
    const after = await h.step(1);
    await h.step(1);
    const looping = await isLooping(h, "music");
    await h.step(TRAIL_FRAMES);
    return { after, looping };
  });

  assertEqual(
    ended.after.run.tick,
    DAWN_TICK,
    "the run clock on the ending tick",
  );
  assertEqual(ended.after.screen, "dawn", "the screen tick 36000 left");
  assertEqual(
    ended.looping,
    false,
    "music looping on the frame after the run ended at dawn",
  );
});
