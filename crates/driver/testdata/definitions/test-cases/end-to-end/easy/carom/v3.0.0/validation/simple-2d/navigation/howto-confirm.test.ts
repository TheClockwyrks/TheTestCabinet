// Carom — navigation/howto-confirm: Enter on the how-to screen returns to the
// title.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// The how-to screen shows a single item and BOTH `confirm` and `back` leave it,
// so confirming it is its own requirement beside `navigation/howto-back`'s.
//
// The screen is POSED — `openHowTo` is `reset`, `setMenuIndex(0)` and
// `setScreen("howto")`, the three atomic poses that are exactly the state
// specs/ui.md says arriving there leaves — rather than reached by confirming the
// title's third entry. Reaching it is `navigation/title-howto`'s point, and a
// build with a broken title menu and a working `confirm` must fail that point and
// pass this one.
//
// What is read is what "Returning to the title" fixes: `screen` is `title`, and
// `menuIndex` becomes `titleIndex`, which `reset` left at `0`.
//
// The field is left exactly as the title state holds it, which is what `reset`
// leaves behind the how-to screen. Nothing advances on `howto` or on `title`
// (specs/ui.md) and the reading is of neither a ball nor an obstacle, so there is
// no bystander to remove. No paddle is taken: a menu is not driven through one.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openHowTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns from the how-to screen to the title on Enter", async () => {
  openHowTo(h);
  const posed = h.snapshot();
  assertEqual(posed.screen, "howto");
  assertEqual(posed.titleIndex, 0);

  await h.tap("Enter");
  captureStill(h, "title");

  const back = h.snapshot();
  assertEqual(back.screen, "title");
  assertEqual(back.menuIndex, 0);
});
