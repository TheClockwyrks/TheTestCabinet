// screens/pause-items — the pause screen draws its whole menu.
//
// specs/ui.md gives `paused` one element, `PAUSE_ITEMS`: `RESUME`, `RESTART` and
// `MENU`. All three are read, because a pause menu missing an entry leaves the
// player unable to reach whatever it named — and each of those three is a point
// of its own under `states`, which this one does not repeat: what is decided here
// is that the screen SHOWS them.
//
// Matching is by substring and ignores case, because a highlighted entry is
// commonly drawn with a marker beside it and that is the build's presentation.
//
// The pause screen is reached through the surface rather than by pressing
// `Escape` over a live round, so a build that cannot pause fails
// `states/pause-reachable` alone.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  drewText,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws RESUME, RESTART and MENU on the pause screen", async () => {
  const paused = poseScene(h, {
    screen: "paused",
    snake: chainFrom(HOME_HEAD, "right", 5),
    dir: "right",
    pellet: null,
  });
  assertEqual(paused.screen, "paused", "the screen the frame is read from");

  const calls = await h.frameCalls();
  captureStill(h, "pause");

  for (const item of PAUSE_ITEMS) {
    assertEqual(drewText(calls, item), true, `the pause menu drawing ${item}`);
  }
});
