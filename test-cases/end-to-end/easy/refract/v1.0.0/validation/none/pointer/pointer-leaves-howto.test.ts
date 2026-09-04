// Refract — pointer/pointer-leaves-howto: taking the back target leaves the
// how-to screen.
//
// specs/ui.md gives `howto` a BACK_LABEL control carrying the `back` target, and
// specs/controls.md says taking it does what the `back` action does on that
// screen: a return to `title` with HOW TO PLAY highlighted (`menuIndex = 2`),
// the entry that led away. Without it a player working the game by touch alone reaches the
// how-to screen and cannot leave it, which is the failure this point exists to
// catch.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressRelease,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title from a press and release on the back control", async () => {
  await h.debug.reset({ seed: 1 });
  await h.advance(1);

  const howto = targetCenter(targetById(await h.snapshot(), "menu-2"));
  await pressRelease(h, howto);
  assertEqual((await h.snapshot()).screen, "howto", "the how-to screen is reached first");

  const back = targetCenter(targetById(await h.snapshot(), "back"));
  await pressRelease(h, back);

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "taking the back target returns to the title, as the back action does " +
      "(specs/ui.md, howto)",
  );
  assertEqual(
    (await h.snapshot()).menuIndex,
    2,
    "with HOW TO PLAY, the entry that led away, highlighted",
  );
  await captureStill(h, "title");
});
