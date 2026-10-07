// screens/title-from-gameover-highlights-start — leaving game over lands on
// START.
//
// specs/screens.md, "What is highlighted on arrival": its table gives `title`,
// entered from `playing`, `paused`, or `gameover`, entry `0`, START. The route is
// specs/screens.md's `gameover` rule: "`confirm` returns to `title`."
//
// THE CONFIRM IS A REAL PRESS, because the arrival rule is about a transition
// and `setScreen` sets the screen and nothing else. Each of the three arrivals
// the table names is its own point, since a build may remember one route and not
// another.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS } from "../constants";
import {
  captureStill,
  openHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = KEYS.confirm[1];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("highlights START on the title left to from game over", async () => {
  const posed = poseScene(h, "gameover");
  assertEqual(posed.screen, "gameover", "the screen the return is made from");

  await tap(h, CONFIRM);
  await h.frameDraw();
  captureStill(h, "gameover");

  const after = h.snapshot();
  assertEqual(after.screen, "title", "the screen the confirm returned to");
  assertEqual(after.menu.index, 0, "the highlight on arrival: START");
});
