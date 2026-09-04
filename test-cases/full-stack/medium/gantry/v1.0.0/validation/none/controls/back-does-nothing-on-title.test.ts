// controls/back-does-nothing-on-title — `back` on the title screen leaves it
// showing.
//
// `specs/controls.md` § The actions, the last row of the `back` table: "Anywhere
// else — Leaves the screen for the one `specs/ui.md` gives it, and does nothing
// on `title`, which has none." `specs/ui.md` § Title says it again of the screen:
// "`SITES` opens `select`, `HOW TO PLAY` opens `howto`, and `back` does nothing."
//
// The title screen is where the harness's opening `reset` leaves the game
// (`specs/instrumentation.md`), so the scenario is the state a fresh game stands
// in and nothing has to be posed to reach it. What the press is watched for is
// the screen alone: a build that read `back` as a screen change has left `title`
// for something, whatever it chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** `back`'s binding, as `specs/controls.md` fixes it. */
const BACK = BINDINGS.back[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stays on the title screen under back", async () => {
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen `back` is pressed on");

  await h.press(BACK);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen after `back` on `title`, which has no screen to leave for " +
      "(specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "the title screen unmoved under back");
});
