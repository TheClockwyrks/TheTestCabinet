// touch/touch-landing-selects — a touch contact selects the item it lands on,
// before it lifts.
//
// THE RULE. `specs/controls.md`, Menu navigation, Pointer and touch: "A finger
// touches down inside an item's region, or travels onto one while down |
// `menuIndex` becomes that item's index."
//
// A FINGER IS NOT A SMALL MOUSE, which is what this point exists for. It never
// hovers, so the first the build hears of it is the contact LANDING, and the
// landing is what selects. A mouse's rule in the same table is a MOVE onto the
// region (`pointer/pointer-hover-selects`), and no mouse point can reach this one:
// a build that only ever selects on a move leaves a finger pointing at whatever
// was selected before it arrived.
//
// THE CONTACT IS NOT LIFTED, and that is the whole of the reading. Lifting it
// would activate the item as well (`touch/touch-tap-confirms`), and the screen
// would change under a check about the selection.
//
// THE CONTACT IS A REAL CHROMIUM TOUCH, dispatched on a context that reports a
// touchscreen, so it arrives as `pointerType: "touch"` on a device a build
// offering touch controls has to believe it is on.
//
// THE REGION IS THE BUILD'S OWN, asked for through `menuItemRect`, so any layout
// passes. The selection starts on the other item so a build that never moves it
// cannot agree by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO_ITEM, TITLE_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  touchItem,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the item the contact landed on, with the contact still down", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(TITLE_NEW_GAME_ITEM);
  assertEqual(
    (await h.snapshot()).menuIndex,
    TITLE_NEW_GAME_ITEM,
    "posing: menuIndex before the contact — a selection already on the item " +
      "below would let this point pass on a menu that never answered",
  );

  await touchItem(h, TITLE_HOW_TO_ITEM);
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a menu that did not answer still leaves the
  // picture of the selection it kept.
  await captureStill(h, "selected");

  assertEqual(
    after.menuIndex,
    TITLE_HOW_TO_ITEM,
    `menuIndex after a touch contact landed inside the region the build ` +
      `reports for item ${TITLE_HOW_TO_ITEM} of the title's menu, and was not ` +
      `lifted — a finger touching down inside an item's region selects that ` +
      `item (specs/controls.md)`,
  );
  assertEqual(
    after.screen,
    "title",
    "the screen the landing left, which a contact that has not lifted does " +
      "not change (specs/controls.md)",
  );
});
