// screens/resume-escape — Escape while paused returns the hall to play.
//
// WHAT THIS DECIDES. One thing: the pause control, pressed while `paused`, moves
// the game back to `playing`. A build that pauses but cannot resume must score
// differently from one that does neither, which is why this is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "pause | `Escape` | — | edge |
//   pauses, and resumes", and ("What each screen reads") "`paused` | pause,
//   which resumes".
//   specs/ui.md ("Screens"): `playing` is "The live hall."
//   specs/instrumentation.md (`pause`, `resume`): "`pause` poses the pause
//   control, moving the screen to `paused`", which is how the precondition below
//   is posed.
//
// THE DRIVE. The paused screen is posed through the surface's own `pause()`
// rather than by pressing Escape: pressing it would make this point fail
// whenever screens/pause-escape fails, and a build that pauses on the key but
// never resumes has to be told apart from one whose pause key does nothing.
// The pose is read back before the press, so a surface that could not pose it
// fails here rather than deciding nothing. `pressPause` is a REAL `Escape`
// dispatched at the engine's own input seam, which is the path this item is
// about.
//
// THE TOLERANCE. None: a screen name is an exact comparison (test-case.toml,
// STANDING TOLERANCES).

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

it("moves the game back to playing when Escape is pressed while paused", async () => {
  await startRun(h);
  await h.step(1);
  h.debug.pause();
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen the press is made from",
  );

  const resumed = await pressPause(h);
  captureStill(h, "resumed");

  assertEqual(resumed.screen, "playing", "the screen Escape left the game on");
});
