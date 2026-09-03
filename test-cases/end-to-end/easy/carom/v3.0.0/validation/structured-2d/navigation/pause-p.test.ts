// Carom — navigation/pause-p: KeyP on the pause menu resumes the match.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// The match is opened into live play through the debug surface — the title menus
// are the other navigation checks' own surface to grade, not this one's — and
// the pause menu over it is POSED: `setScreen("paused")`, then the frame the
// header's discipline asks for, then `setResumeScreen("playing")` and
// `setMenuIndex(0)`, which are the fields specs/ui.md says a `pause` edge sets.
// Opening it with a press instead would put `KeyP` at BOTH ends of this check,
// and a failure could no longer say whether the key that pauses or the key that
// resumes is the broken one. The key that opens the menu is `controls-solo/p`
// and `controls-versus/p`'s point; this one presses `KeyP` once, on `paused`,
// and reads where the game went.
//
// `KeyP` raises `pause` and nothing else, and specs/ui.md makes `pause` on
// `paused` resume to `resumeScreen`. That is what separates this point from
// `pause-escape`: `Escape` carries `back` alongside `pause` and either of them
// would resume, so only this press can say the `pause` action itself was read.
//
// The field is isolated to the one ball live play needs and no obstacles, so
// nothing behind the menu can bank a shot into a goal and move the screen this
// point is reading. Neither paddle is taken from the player: this check presses
// one menu key alone, and a driven paddle would be scenery it does not need.
//
// The key is a real key event dispatched at the target the engine listens on, so
// the action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openIsolatedPlay,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes the paused match on KeyP", async () => {
  const live = await openIsolatedPlay(h, { mode: "versus" });
  assertEqual(live.hit, true);

  h.debug.setScreen("paused");
  await h.advance(1);
  h.debug.setResumeScreen("playing");
  h.debug.setMenuIndex(0);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "playing");

  await h.tap("KeyP");
  captureStill(h, "resumed");

  assertEqual(h.snapshot().screen, "playing");
});
