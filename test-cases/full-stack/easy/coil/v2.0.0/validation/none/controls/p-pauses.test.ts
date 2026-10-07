// controls/p-pauses — KeyP pauses a live round.
//
// specs/controls.md binds `pause` to `KeyP` and, on the `playing` screen, makes
// `pause` "Pause the round"; the file adds that "`back` and `pause` both pause a
// live round, so a player reaches the pause menu with either `Escape` or `KeyP`."
// This is its own point rather than a repeat of the `Escape` one, because a build
// that bound only `Escape` is fully playable and loses this alone.
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

it("sets the screen to paused on KeyP during a round", async () => {
  const live = await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });
  assertEqual(live.screen, "playing", "the screen the key is pressed on");

  await h.tap(KEY.pause);
  await captureStill(h, "paused");

  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen KeyP opened from a live round",
  );
});
