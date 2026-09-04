// touch/touch-drag-cancels — a contact that lifts on a different item activates
// nothing, and leaves the item it travelled onto selected.
//
// THE RULE. `specs/controls.md`, Menu navigation, Pointer and touch, two rows of
// one table: "A finger touches down inside an item's region, OR TRAVELS ONTO ONE
// WHILE DOWN | `menuIndex` becomes that item's index", and "The two edges of a
// gesture land in different regions ... | No item is activated."
//
// SO BOTH HALVES ARE READ, and they are what separate this point from its mouse
// sibling. A finger that slides off the item it landed on has changed its mind,
// and the specification has the menu follow it — the selection moves — while the
// activation does not happen. A build that activates on the landing takes the
// player to the item they slid OFF; a build that activates on the lift takes them
// to the one they slid ONTO; and a build that never follows a travelling contact
// leaves the selection on the item they left. Each is a different answer.
//
// THE TWO ITEMS' EFFECTS REACH TWO DIFFERENT SCREENS (`specs/screens.md`), so
// neither wrong activation can pass by accident.
//
// THE CONTACT IS A REAL CHROMIUM TOUCH on a context that reports a touchscreen,
// and both regions are the build's own, asked for through `menuItemRect`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO_ITEM, TITLE_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  touchBetweenItems,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the item the contact slid onto and activates neither", async () => {
  await openTitle(h);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "posing: the screen the contact is made on",
  );

  // Land inside NEW GAME, travel onto HOW TO PLAY, lift there.
  await touchBetweenItems(h, TITLE_NEW_GAME_ITEM, TITLE_HOW_TO_ITEM);
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a contact that activated something still leaves
  // the picture of the screen it reached.
  await captureStill(h, "title");

  assertEqual(
    after.screen,
    "title",
    `the screen a contact that landed inside item ${TITLE_NEW_GAME_ITEM}'s ` +
      `region and lifted inside item ${TITLE_HOW_TO_ITEM}'s left the game on ` +
      `— two edges in different regions activate no item (specs/controls.md), ` +
      `so "playing" means the landing's item was activated and "howto" means ` +
      `the lift's was`,
  );
  assertEqual(
    after.menuIndex,
    TITLE_HOW_TO_ITEM,
    `menuIndex after that contact — a finger that travels onto an item's ` +
      `region while down selects that item (specs/controls.md)`,
  );
});
