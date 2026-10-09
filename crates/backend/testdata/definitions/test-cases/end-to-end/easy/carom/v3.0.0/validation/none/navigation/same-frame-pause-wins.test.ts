// navigation/same-frame-pause-wins — on the pause menu, a frame carrying a pause
// edge and a movement edge resumes and does nothing else.
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
// The pause menu is posed over an EMPTIED field with `reachPaused`, so the key
// that OPENS it is the pause category's point and not this one's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachPaused } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes and leaves the selection alone when both edges land on one frame", async () => {
  await reachPaused(h, "versus");
  const paused = await h.snapshot();
  assertEqual(paused.resumeScreen, "playing");
  assertEqual(paused.menuIndex, 0);

  await h.hold("KeyP");
  await h.hold("ArrowDown");
  await h.advance(1);
  await h.release("KeyP");
  await h.release("ArrowDown");
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(resumed.screen, paused.resumeScreen);
  assertEqual(resumed.menuIndex, 0);
});
