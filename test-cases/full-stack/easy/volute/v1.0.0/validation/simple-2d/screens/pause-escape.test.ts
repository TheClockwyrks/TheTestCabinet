// screens/pause-escape — Escape during play pauses the hall.
//
// WHAT THIS DECIDES. One thing: the pause control, pressed while `playing`,
// moves the game to `paused`. What a pause does to the TRAIN is a separate
// point (screens/pause-freezes), and resuming is another (screens/resume-escape).
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "pause | `Escape` | — | edge |
//   pauses, and resumes", and ("What each screen reads") "`playing` | the
//   pointer, the two turn actions, fire, swap, and pause, which pauses".
//   specs/ui.md ("Screens"): `paused` is "The hall held still."
//
// THE DRIVE. The run is opened through the debug surface rather than through the
// title's own confirm key: a build with a broken title must fail the title
// points and still be graded on its pause key. One tick of live play is run
// first, so the press really is made "during play", and the screen is read back
// before the press so a build that could not be posed into play fails here
// rather than deciding nothing. `pressPause` is a REAL `Escape` dispatched at
// the engine's own event target, which is the path this item is about.
//
// THE TOLERANCE. None: a screen name is an exact comparison (test-case.toml,
// STANDING TOLERANCES). Nothing asserts what the paused screen DRAWS — specs/ui.md
// requires "a legible indication that the game is paused" and fixes no palette,
// font or layout for it, so that is the reviewer's reading of the still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressPause,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the game to paused when Escape is pressed in play", async () => {
  await startRun(h);
  const live = await h.step(1);
  assertEqual(live.screen, "playing", "the screen the press is made from");

  const paused = await pressPause(h);
  await captureStill(h, "paused");

  assertEqual(paused.screen, "paused", "the screen Escape left the game on");
});
