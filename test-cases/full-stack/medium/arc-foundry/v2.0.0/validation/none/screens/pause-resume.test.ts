// screens/pause-resume — RESUME returns to playing and clears the in-place pause.
//
// THE REQUIREMENT. `specs/ui.md`, of `paused`: "`RESUME` returns to `playing` and
// clears any in-place pause." `specs/controls.md` says the same from the control's
// side: "Resuming from it also clears any in-place pause." That second clause is
// the whole point of this check. A player who pauses in place with `Space` and
// then opens the pause menu on top of it has two pauses engaged, and a build that
// closes the menu without clearing the in-place one drops the player back on a
// `playing` screen that does not play.
//
// HOW IT IS DECIDED. The harder of the two states is the one posed: the in-place
// pause is engaged FIRST, and the pause menu is opened over it. `RESUME` is then
// found by the action it carries rather than by where it was drawn and pressed at
// the centre of the rectangle the build itself reported for it, and both fields
// are read: the screen is back on `playing`, and `paused` is false.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressMenu,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the in-place pause that was engaged before the menu opened", async () => {
  await openYard(h, { wave: 6 });
  await h.debug.setPaused(true);
  await h.debug.setScreen("paused");

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "paused",
    "the pause menu showing before RESUME is taken (specs/ui.md)",
  );
  assertEqual(
    posed.paused,
    true,
    "the in-place pause engaged underneath it, which is the state RESUME has " +
      "to clear as well (specs/controls.md)",
  );

  await pressMenu(h, "resume");
  await captureStill(h, "resume");

  const resumed = await h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen RESUME returns to (specs/ui.md)",
  );
  assertEqual(
    resumed.paused,
    false,
    "the in-place pause after RESUME, which clears any in-place pause " +
      "(specs/ui.md, specs/controls.md)",
  );
});
