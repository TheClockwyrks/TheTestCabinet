// screens/select-back-returns-to-title — `back` on the select screen returns to
// the title.
//
// `specs/ui.md` § The screens, Site select: "`confirm` on a locked site does
// nothing; and `back` returns to `title`." The title screen is where the site
// list is entered from, so `back` is the way out of it.
//
// The screen is posed with `setScreen`, which "shows a named screen and sets
// nothing else" (`specs/instrumentation.md`), rather than reached by taking
// `SITES` off the title menu: what that entry opens is its own review point, and a
// build that never reached `select` must fail that item and be decided fairly on
// this one. The highlight is posed too, because `setScreen` leaves `menuIndex` as
// it stands and a menu screen showing an out-of-range highlight is not the screen
// this item is about.

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

it("leaves the select screen for the title under back", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(0);
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "the screen `back` is pressed on",
  );

  await h.press(BACK);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen `back` on `select` returns to (specs/ui.md)",
  );

  await h.advance(1);
  await h.capture("state", "The screen back returned to from the site list");
});
