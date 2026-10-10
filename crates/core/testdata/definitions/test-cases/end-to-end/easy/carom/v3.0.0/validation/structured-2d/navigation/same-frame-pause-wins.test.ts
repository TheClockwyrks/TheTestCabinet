// Carom — navigation/same-frame-pause-wins: on the pause menu, a frame carrying a
// pause edge and a movement edge resumes and does nothing else.
//
// specs/ui.md, at the end of its keyboard section: on `paused`, `pause` and
// `back` are read before the menu edges, and a frame carrying either resumes and
// does nothing else. So the frame this drives has to leave the game on
// `resumeScreen` with the selection where it was.
//
// `KeyP` is the pause edge rather than `Escape`. `Escape` raises `pause` AND
// `back` together (specs/ui.md), and either of them would resume, so a failure
// could not say which rule was read; `KeyP` raises `pause` alone.
//
// Reading both halves is the point. `screen` at `resumeScreen` says the pause
// was applied; `menuIndex` still 0 says the movement edge on that same frame was
// not. A build that applied the movement as well would resume from RESTART's
// index, and one that applied the movement instead would still be paused.
//
// Both keys are HELD before the frame is driven and released after it, so their
// two edges land in ONE input read; `tap` would run a frame between them.
//
// The field is isolated to the one ball live play needs and no obstacles, so
// nothing behind the menu can bank a shot into a goal and move the screen this
// point is reading. Neither paddle is taken from the player.
//
// The pause menu is POSED by `openIsolatedPaused`, so the key that OPENS it is
// `controls-*/p`'s point rather than this one's.
//
// The keys are real key events dispatched at the target the engine listens on.
// The still is the frame the two edges left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openIsolatedPaused,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes and leaves the selection alone when both edges land on one frame", async () => {
  const live = await openIsolatedPaused(h, { mode: "versus" });
  assertEqual(live.hit, true);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "playing");
  assertEqual(paused.menuIndex, 0);

  h.hold("KeyP");
  h.hold("ArrowDown");
  await h.advance(1);
  h.release("KeyP");
  h.release("ArrowDown");
  captureStill(h, "resumed");

  const resumed = h.snapshot();
  assertEqual(resumed.screen, paused.resumeScreen);
  assertEqual(resumed.menuIndex, 0);
});
