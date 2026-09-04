// screens/pause-resume-clears-the-in-place-pause — RESUME also clears a pause
// engaged in place.
//
// THE REQUIREMENT. `specs/ui.md`, of `paused`: "`RESUME` returns to `playing` and
// clears any in-place pause." `specs/controls.md` says the same from the control's
// side: "Resuming from it also clears any in-place pause."
//
// TWO CLAIMS, TWO POINTS. A build that closes the menu without clearing an
// in-place pause drops the player back on a `playing` screen that does not play,
// and a build whose RESUME does not close the menu at all leaves them stuck in it.
// Those are different failures and they cost the player different things, so the
// screen change and the in-place pause are decided apart. The screen change is
// the sibling point `pause-resume`.
//
// RESUME IS FOUND BY THE ACTION IT CARRIES rather than by where it was drawn, and
// pressed at the centre of the rectangle the build itself reported for it.
//
// THE HARDER OF THE TWO STATES IS THE ONE POSED. A player who pauses in place with
// `Space` and then opens the pause menu on top of it has two pauses engaged, so
// the in-place pause is engaged FIRST and the menu is opened over it.

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

it("clears the in-place pause that was engaged before the menu opened", async () => {
  openYard(h, { wave: 6 });
  h.debug.setPaused(true);
  h.debug.setScreen("paused");
  assertEqual(
    h.snapshot().paused,
    true,
    "the in-place pause engaged underneath the menu, which is the state " +
      "RESUME has to clear as well (specs/controls.md)",
  );

  await pressMenu(h, "resume");
  captureStill(h, "resume");

  assertEqual(
    h.snapshot().paused,
    false,
    "the in-place pause after RESUME, which clears any in-place pause " +
      "(specs/ui.md, specs/controls.md)",
  );
});
