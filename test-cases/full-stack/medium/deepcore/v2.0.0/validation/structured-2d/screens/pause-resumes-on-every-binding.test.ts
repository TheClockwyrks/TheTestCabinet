// screens/pause-resumes-on-every-binding — every key bound to `pause` resumes.
//
// `specs/ui.md`: "The `pause` action is raised by `Escape` and by `KeyP` alike, so
// either key opens the pause menu from `in-mine` and either resumes the expedition
// from `paused`." The transition table states the same row: `paused` | `RESUME`,
// or the `pause` action | `in-mine`.
//
// SO EVERY CODE IS PRESSED, each from a fresh `paused`, and each must put the
// game back in the mine. `ACTIONS.pause` is this project's transcription of
// `specs/controls.md`'s bindings table, so nothing here writes a key down of its
// own.
//
// ONE DIRECTION PER POINT. `screens/pause-opens-on-every-binding` decides the way
// in. That `RESUME` carries the frozen fall on from where it stopped is
// `screens/pause-resume`'s point; this one is only about the key.
//
// ISOLATION. The pause menu posed directly through the surface over a mine posed
// the same way, so nothing about the menus is on the route in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ACTIONS } from "../constants";
import {
  captureStill,
  createHarness,
  openScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes the expedition from every code bound to pause", async () => {
  for (const code of ACTIONS.pause) {
    openScene(h);
    h.debug.setScreen("paused");
    assertEqual(
      h.snapshot().screen,
      "paused",
      "the pause menu open before the key is pressed",
    );

    await h.tap(code);
    if (code === ACTIONS.pause[ACTIONS.pause.length - 1]) {
      captureStill(h, "resumed");
    }

    assertEqual(
      h.snapshot().screen,
      "in-mine",
      `specs/ui.md: ${code} raises the pause action and resumes the expedition`,
    );
  }
});
