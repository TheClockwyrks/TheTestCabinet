// Meltdown — screens/back-from-howto: leaving the how-to screen returns to the
// title.
//
// THE RULE. specs/screens.md, `howto`: "`back` returns to `title`."
// specs/controls.md reaches that through the fourth case of its resolution order,
// "Otherwise: leave the current screen".
//
// IT IS ITS OWN ITEM BECAUSE THE HOW-TO IS NOT A MENU. It draws no list of rows,
// so a build that resolves `back` off the menu it is showing has nothing to
// resolve here — and a player who opened the how-to and cannot get out of it is
// stuck on the one screen with no other exit. That is exactly the defect this
// item catches, and it is a different defect from a back that fails on a list,
// which `screens.back-from-mode-select` and
// `screens.back-from-difficulty-select` read.
//
// THE PRECONDITION IS PART OF THE RULE: nothing armed and nothing selected, so
// `back`'s first two cases do not apply, and the screen is not `playing`, so its
// third does not either. All three are read back before the press.
//
// WHAT THE SCREEN COVERS is `screens.howto-content`'s requirement; this reads only
// the way out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when back is pressed on the how-to screen", async () => {
  resetTo(h);
  h.debug.setScreen("howto");
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "howto", "the screen the scenario is posed on");
  assertNull(before.build, "the held preview the scenario is posed with");
  assertNull(before.selected, "the selection the scenario is posed with");

  await tapAction(h, "back");
  captureStill(h, "back");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen back leaves the how-to screen on",
  );
});
