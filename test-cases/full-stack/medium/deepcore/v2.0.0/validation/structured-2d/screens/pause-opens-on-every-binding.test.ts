// screens/pause-opens-on-every-binding — every key bound to `pause` opens the menu.
//
// `specs/ui.md`: "The `pause` action is raised by `Escape` and by `KeyP` alike, so
// either key opens the pause menu from `in-mine`". `specs/controls.md`'s bindings
// table says the same from the controls' side, giving `pause` both codes. A build
// that wired only the first leaves a player who reaches for `P` with a game that
// does not pause.
//
// SO EVERY CODE IS PRESSED. `ACTIONS.pause` is this project's transcription of
// that table, and each code in it is taken in turn from a fresh `in-mine`: the
// action is raised by ALL of them or the point fails, naming the code that did
// nothing. Nothing here writes a key down of its own.
//
// ONE DIRECTION PER POINT. `screens/pause-resumes-on-every-binding` decides the
// way back out. That the menu opens at all, and that it freezes the mine, are
// `screens/pause-freezes-the-mine`'s point.
//
// ISOLATION. The mine posed through the surface with no panel open, because
// `specs/ui.md` gives `pause` a different job while one is: "With a panel open,
// `pause` closes that panel and leaves the screen on `in-mine`".

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

it("opens the pause menu from every code bound to pause", async () => {
  for (const code of ACTIONS.pause) {
    openScene(h);
    assertEqual(
      h.snapshot().screen,
      "in-mine",
      "the mine open before the key is pressed",
    );

    await h.tap(code);
    if (code === ACTIONS.pause[ACTIONS.pause.length - 1]) {
      captureStill(h, "paused");
    }

    assertEqual(
      h.snapshot().screen,
      "paused",
      `specs/ui.md: ${code} raises the pause action and opens the pause menu`,
    );
  }
});
