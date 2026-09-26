// touch/touch-tap-confirms — a contact that lifts where it landed activates that
// item.
//
// THE RULE. `specs/controls.md`, Menu navigation, Pointer and touch: "A press and
// the release that follows it both land inside one item's region | `menuIndex`
// becomes that item's index, and the item is activated", and the paragraph above
// it: "a finger landing and lifting inside one region activates its item exactly
// as a mouse click does".
//
// WHY THE FINGER HAS ITS OWN POINT. `specs/controls.md` requires the game to be
// "complete on a touch device with no mouse attached", so a menu that answers a
// mouse and not a finger leaves a player holding a tablet with a game they can
// look at and not play. The contact here is a real Chromium touch on a context
// that reports a touchscreen, so a build that answers `pointerType: "mouse"`
// alone fails here and passes `pointer/pointer-click-confirms`.
//
// THE ITEM IS THE SECOND ONE, whose effect a check reads straight off `screen`:
// `HOW TO PLAY` moves to `howto` and the item beside it deals a fresh game and
// reaches `playing` (`specs/screens.md`), so a build that activates whatever item
// it likes lands on a different screen rather than agreeing by accident.
//
// THE REGION IS THE BUILD'S OWN, asked for through `menuItemRect`, so any layout
// passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO_ITEM, TITLE_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  tapItem,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("activates the item a contact landed and lifted inside", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(TITLE_NEW_GAME_ITEM);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "posing: the screen the contact is made on",
  );

  await tapItem(h, TITLE_HOW_TO_ITEM);
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertion, so a tap that reached the wrong screen still leaves
  // the picture of it.
  await captureStill(h, "howto");

  assertEqual(
    after.screen,
    "howto",
    `the screen a contact that landed and lifted inside the region the build ` +
      `reports for item ${TITLE_HOW_TO_ITEM} of the title's menu reached — a ` +
      `finger landing and lifting inside one region activates its item exactly ` +
      `as a mouse click does (specs/controls.md), and HOW TO PLAY moves to ` +
      `howto (specs/screens.md)`,
  );
});
