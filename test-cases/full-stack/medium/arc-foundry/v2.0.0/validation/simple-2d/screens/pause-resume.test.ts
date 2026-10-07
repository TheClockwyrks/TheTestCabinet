// screens/pause-resume — RESUME returns the screen to playing.
//
// THE REQUIREMENT. `specs/ui.md`, of `paused`: "`RESUME` returns to `playing` and
// clears any in-place pause." `specs/controls.md` says the same from the control's
// side: "Resuming from it also clears any in-place pause."
//
// TWO CLAIMS, TWO POINTS. A build that closes the menu without clearing an
// in-place pause drops the player back on a `playing` screen that does not play,
// and a build whose RESUME does not close the menu at all leaves them stuck in it.
// Those are different failures and they cost the player different things, so the
// screen change and the in-place pause are decided apart. The in-place pause is
// the sibling point `pause-resume-clears-the-in-place-pause`.
//
// RESUME IS FOUND BY THE ACTION IT CARRIES rather than by where it was drawn, and
// pressed at the centre of the rectangle the build itself reported for it.

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

afterEach(() => {
  h.dispose();
});

it("returns to the playing screen", async () => {
  openYard(h, { wave: 6 });
  h.debug.setScreen("paused");
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the pause menu showing before RESUME is taken (specs/ui.md)",
  );

  await pressMenu(h, "resume");
  captureStill(h, "resume");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen RESUME returns to (specs/ui.md)",
  );
});
