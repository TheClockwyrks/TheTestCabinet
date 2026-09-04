// controls/p-resumes — KeyP resumes from the pause screen.
//
// specs/controls.md gives `pause` its one exception: on a menu-bearing screen it
// does "Nothing, except on `paused`, where it resumes the round." specs/ui.md
// says the same from the screen's side: "`back` and `pause` both return to
// `playing`, exactly as `RESUME` does." So the same key both opens and closes the
// pause, and this is the closing half — a build that pauses on `KeyP` and then
// ignores it has trapped the player in the menu.
//
// The pause screen is reached through the surface rather than by pressing the key
// that opens it, so a build that cannot pause fails `controls/p-pauses` alone.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds to `pause`. */
const PAUSE = BINDINGS.pause[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the screen back to playing on KeyP while paused", async () => {
  const paused = poseScene(h, {
    screen: "paused",
    menuIndex: 0,
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
  });
  assertEqual(paused.screen, "paused", "the screen the key is pressed on");

  await h.tap(PAUSE);
  captureStill(h, "resumed");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen KeyP returned to from the pause menu",
  );
});
