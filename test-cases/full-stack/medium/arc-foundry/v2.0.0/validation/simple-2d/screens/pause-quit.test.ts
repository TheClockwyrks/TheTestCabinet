// screens/pause-quit — QUIT TO MENU returns to the title.
//
// THE REQUIREMENT. `specs/ui.md`, of `paused`: "`QUIT TO MENU` returns to
// `title`." It is the only way out of a run that a player has not lost or won, so
// a build without it traps the player in whatever campaign they last started.
//
// HOW IT IS DECIDED. A run is posed mid-campaign with structures standing on the
// yard, so what is left is a run in progress rather than an untouched one, and the
// pause menu is opened directly through the operation that reaches a screen
// "exactly as reaching it in play does". `QUIT TO MENU` is found by the action it
// carries rather than by where it was drawn, and pressed at the centre of the
// rectangle the build itself reported for it. The screen is read back.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressMenu,
  standComponent,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to the title from a run in progress", async () => {
  openYard(h, { wave: 9, charge: 400 });
  standComponent(h, "capacitor", 3, 10, 0);

  h.debug.setScreen("paused");
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the pause menu showing before QUIT TO MENU is taken (specs/ui.md)",
  );

  await pressMenu(h, "quit");
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen QUIT TO MENU returns to (specs/ui.md)",
  );
});
