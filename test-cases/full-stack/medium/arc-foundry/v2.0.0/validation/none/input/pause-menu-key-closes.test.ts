// input/pause-menu-key-closes — `KeyP` closes the pause menu and resumes.
//
// THE REQUIREMENT. `specs/controls.md`: `pause-menu` "closes it and resumes on
// `paused`", and `specs/ui.md` of `paused`: "`Escape` and `KeyP` each close the
// pause menu and resume the run, doing exactly what `RESUME` does." `RESUME`
// "returns to `playing` and clears any in-place pause", so both halves are read
// back here.
//
// HOW IT IS DECIDED. A run is opened, the pause menu is reached through the key
// this point is about, and the key is pressed a second time. The screen and the
// in-place pause bit are read back.

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

afterEach(async () => {
  await h.dispose();
});

it("closes the pause menu and resumes when the pause-menu key is pressed on paused", async () => {
  await openYard(h);
  await h.tap(PAUSE_MENU_KEY);
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the pause menu open before the key is pressed again (specs/ui.md)",
  );

  await h.tap(PAUSE_MENU_KEY);
  await captureStill(h, "resume");

  const resumed = await h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    `pressing ${PAUSE_MENU_KEY} on paused to close the pause menu and resume ` +
      "(specs/controls.md, specs/ui.md)",
  );
  assertEqual(
    resumed.paused,
    false,
    "the in-place pause after resuming, which resuming clears exactly as " +
      "RESUME does (specs/ui.md)",
  );
});
