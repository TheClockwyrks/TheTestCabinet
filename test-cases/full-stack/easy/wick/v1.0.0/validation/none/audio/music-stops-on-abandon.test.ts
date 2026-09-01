// audio/music-stops-on-abandon — music is not looping on the frame after back on
// paused returns to the title.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`music` is looping
// on every frame exactly when `screen` is `playing`, `levelup`, `chest`, or
// `paused` ... and it stops on the frame the run ends, fallen or at dawn, or
// `back` on `paused` abandons it", and "`title` and `howto` carry no music."
// specs/ui.md ("`paused`") names the abandon: "`back` abandons the run and
// returns to `title` with `menuIndex = 0`." specs/instrumentation.md fixes the
// frame the reading is taken on: "Both loops are reconciled from the state on
// every frame, so a state the debug surface posed sounds, one frame later,
// exactly as the same state reached by play."
//
// WHY THE ABANDON IS PRESSED AND THE PAUSE IS POSED. The abandon is the event
// this point is about, so it is raised the way a player raises it: `back` is
// bound to `Escape` (specs/controls.md), and the keyboard belongs to the runtime,
// where "a dispatched keyboard event ... works the menus exactly as a player's
// key does" (specs/instrumentation.md). The pause it is pressed from is only the
// way in, so it is posed through the surface, whose `setScreen("paused")` from
// `playing` is defined as "Exactly as `pause` does" — a build with a broken pause
// key fails `controls/`, not this.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so nothing can end the run
// before the abandon and no other transition can move the screen.
//
// WHY THE LOOP IS ESTABLISHED FIRST. Without it the check would pass on a build
// whose music never runs at all, which is a different build from one that fails
// to stop it. The loop is waited for on `playing` before the pause, one frame per
// crossing, and asserted; the wait is a drive length rather than a threshold,
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
  poseScreen,
  pressBack,
  type Harness,
} from "../harness";
import { openNight, stepUntilLoop } from "./cues";

/** Frames recorded on the title after the reading, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops music by the frame after back on paused abandons the run", async () => {
  await openNight(h);
  const running = await stepUntilLoop(h, "music");
  assertEqual(running, true, "music looping on playing before the pause");

  const paused = await poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the pause posed");

  const abandoned = await captureReplay(h, "stopped", async () => {
    const after = await pressBack(h);
    await h.step(1);
    const looping = await isLooping(h, "music");
    await h.step(TRAIL_FRAMES);
    return { after, looping };
  });

  assertEqual(
    abandoned.after.screen,
    "title",
    "the screen back on paused returned to",
  );
  assertEqual(
    abandoned.looping,
    false,
    "music looping on the frame after the run was abandoned",
  );
});
