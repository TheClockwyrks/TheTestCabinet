// Refract — pointer/pointer-leaves-howto: taking the back target leaves the
// how-to screen.
//
// specs/ui.md gives `howto` a BACK_LABEL control carrying the `back` target, and
// specs/controls.md says taking it does what the `back` action does on that
// screen. Without it a player working the game by touch alone reaches the
// how-to screen and cannot leave it, which is the failure this point exists to
// catch.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressRelease,
  resetTo,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from a press and release on the back control", async () => {
  await resetTo(h, 1);

  const howto = targetCenter(targetById(h.snapshot(), "menu-2"));
  await pressRelease(h, howto);
  assertEqual(h.snapshot().screen, "howto", "the how-to screen is reached first");

  const back = targetCenter(targetById(h.snapshot(), "back"));
  await pressRelease(h, back);

  assertEqual(
    h.snapshot().screen,
    "title",
    "taking the back target returns to the title, as the back action does " +
      "(specs/ui.md, howto)",
  );
  assertEqual(h.snapshot().menuIndex, 0, "with the first item highlighted");
  captureStill(h, "title");
});
