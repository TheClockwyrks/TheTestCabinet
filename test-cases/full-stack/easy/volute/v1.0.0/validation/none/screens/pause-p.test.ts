// screens/pause-p — `P` during play pauses the hall.
//
// WHAT THIS DECIDES. One thing: the pause control, raised on `P` while
// `playing`, moves the game to `paused`. Escape is the same transition on the
// other key and is its own point (screens/pause-escape), because a build that
// bound only one of the two has to be told apart from one that bound neither.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Pausing"): "Pause is bound to `Escape` and to `KeyP`.
//   Either key opens the pause from `playing`, and either key returns the game
//   to `playing` from `paused`. The two keys are interchangeable on both
//   transitions."
//   specs/controls.md ("What each screen reads"): "`playing` | the pointer, the
//   two turn actions, fire, swap, and pause, which pauses".
//   specs/ui.md ("Screens"): `paused` is "The hall held still."
//
// THE DRIVE. The run is opened through the debug surface rather than through the
// title's own confirm key: a build with a broken title must fail the title
// points and still be graded on its pause key. One tick of live play is run
// first, so the press really is made "during play", and the screen is read back
// before the press so a build that could not be posed into play fails here
// rather than deciding nothing. `pressPauseAlt` raises the pause control on the
// second key `BINDINGS.pause` names, through the real input path.
//
// THE TOLERANCE. None: a screen name is an exact comparison (test-case.toml,
// STANDING TOLERANCES).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressPauseAlt,
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

it("moves the game to paused when P is pressed in play", async () => {
  await startRun(h);
  const live = await h.step(1);
  assertEqual(live.screen, "playing", "the screen the press is made from");

  const paused = await pressPauseAlt(h);
  await captureStill(h, "paused");

  assertEqual(paused.screen, "paused", "the screen P left the game on");
});
