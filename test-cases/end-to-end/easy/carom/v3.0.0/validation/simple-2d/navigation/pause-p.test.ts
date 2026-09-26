// Carom — navigation/pause-p: KeyP on the pause menu resumes the match.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// The pause menu is POSED over a live match — `enterPlaying` reaches `playing`
// and `openPause` is `setResumeScreen("playing")`, `setMenuIndex(0)` and
// `setScreen("paused")`, the three fields specs/ui.md says a `pause` edge sets.
// Pressing `KeyP` to GET there is `controls-solo/p` and `controls-versus/p`'s
// point, and a build that cannot open the pause menu must fail those rather than
// this one — pressing the key at both ends would fail this point for a defect
// that is not its own.
//
// The field is emptied. This point is about a screen transition, so it concerns
// no ball and no obstacle, and a ball that leaked past a broken pause could score
// and take the screen away from the reading — which would report the pause's
// defect against the resume's point. `clearWorld` removes them outright rather
// than parking them somewhere harmless. The paddles are furniture the field
// always has, and nothing here takes one: no menu is driven through a paddle.
//
// `KeyP` raises `pause` and nothing else, and specs/ui.md makes `pause` on
// `paused` resume to `resumeScreen`. That is what separates this point from
// `pause-escape`: `Escape` carries `back` alongside `pause` and either would
// resume, so only this press can say the `pause` action itself was read.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enterPlaying,
  openPause,
  poseWorld,
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
  enterPlaying(h, "versus");
  poseWorld(h, { balls: [], obstacles: [] });
  openPause(h, "playing");

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "playing");

  await h.tap("KeyP");
  captureStill(h, "resumed");

  assertEqual(h.snapshot().screen, "playing");
});
