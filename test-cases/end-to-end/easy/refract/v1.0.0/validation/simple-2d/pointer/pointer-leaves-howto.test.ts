// Refract — pointer/pointer-leaves-howto: taking the back target leaves the
// how-to screen.
//
// specs/ui.md gives `howto` a BACK_LABEL control carrying the `back` target,
// and specs/controls.md says taking it does what the `back` action does on that
// screen: a return to `title` with HOW TO PLAY highlighted (`menuIndex = 2`).
// Without it a player working the game by touch alone reaches the how-to screen
// and cannot leave it, which is the failure this point exists to catch.
//
// The screen is POSED with `setScreen`, not reached through the title's
// `menu-2` target: taking a title item is `pointer/pointer-takes-a-title-
// item`'s requirement, and a build that misplaces that target must fail that
// point alone.

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
  await resetTo(h);

  h.debug.setScreen("howto");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "howto", "posing: the how-to screen is up");

  const back = targetCenter(targetById(h.snapshot(), "back"));
  await pressRelease(h, back);

  assertEqual(
    h.snapshot().screen,
    "title",
    "taking the back target returns to the title, as the back action does " +
      "(specs/ui.md, howto)",
  );
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "with HOW TO PLAY, the entry that led away, highlighted",
  );
  captureStill(h, "title");
});
