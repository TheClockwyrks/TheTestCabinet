// controls/escape-pauses — Escape pauses a live round.
//
// specs/controls.md binds `back` to `Escape` and, on the `playing` screen, makes
// `back` "Pause the round"; specs/ui.md reaches `paused` from `playing`. `Escape`
// is the one key that means two things in this game — `back` on a menu, the pause
// on a live round — so what is read here is that a build resolves it as the pause
// while a round is running.
//
// The round is reached through the surface rather than through the title menu, so
// a build whose menus do not work still has this key decided, and the chain is
// held still with nothing on the board so the round cannot end underneath the
// press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the screen to paused on Escape during a round", async () => {
  const live = await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });
  assertEqual(live.screen, "playing", "the screen the key is pressed on");

  await h.tap(KEY.back);
  await captureStill(h, "paused");

  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen Escape opened from a live round",
  );
});
