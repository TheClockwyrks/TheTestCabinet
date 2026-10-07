// controls/escape-resumes — Escape resumes from the pause screen.
//
// specs/controls.md gives `back`, on a menu-bearing screen, "Leaves the screen
// for the one it was reached from", and specs/ui.md says it outright for this
// screen: "`back` and `pause` both return to `playing`, exactly as `RESUME`
// does." `KeyP` closing the same screen is `controls/p-resumes`, and they are two
// points because they are two bindings — a build that answers one and swallows
// the other has trapped a player who reached for the wrong key.
//
// The pause screen is reached through the surface rather than by pressing the key
// that opens it, so a build that cannot pause fails `controls/escape-pauses`
// alone.

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

it("sets the screen back to playing on Escape while paused", async () => {
  const paused = await poseScene(h, {
    screen: "paused",
    menuIndex: 0,
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
  });
  assertEqual(paused.screen, "paused", "the screen the key is pressed on");

  await h.tap(KEY.back);
  await captureStill(h, "resumed");

  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen Escape returned to from the pause menu",
  );
});
