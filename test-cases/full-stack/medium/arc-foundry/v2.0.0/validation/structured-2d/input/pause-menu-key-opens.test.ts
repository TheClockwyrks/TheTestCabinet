// input/pause-menu-key-opens — `KeyP` opens the pause menu from playing.
//
// THE REQUIREMENT. `specs/controls.md` binds `pause-menu` to `Escape, KeyP` and
// gives it one effect: it "opens the pause menu on `playing`, and closes it and
// resumes on `paused`". `specs/ui.md` says the same from the screen's side: "The
// pause menu is opened from here, by `KeyP` and by `Escape`." The two keys are
// separate points because they resolve differently — `Escape` fires `back` as well
// and `back` may spend the press — so a build that wired only `Escape` still owes
// the player the key that always reaches the menu.
//
// HOW IT IS DECIDED. A run is opened on an otherwise empty yard, `KeyP` is pressed
// once as a player presses it, and the screen is read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_MENU_KEY } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens the pause menu when the pause-menu key is pressed on playing", async () => {
  openYard(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "a run on the playing screen before the key is pressed (specs/ui.md)",
  );

  await h.tap(PAUSE_MENU_KEY);
  captureStill(h, "open");

  assertEqual(
    h.snapshot().screen,
    "paused",
    `pressing ${PAUSE_MENU_KEY} on playing to open the pause menu ` +
      "(specs/controls.md, specs/ui.md)",
  );
});
