// navigation/menu-movement-beats-confirm-in-a-frame — a frame carrying a movement
// edge and a confirm edge moves the selection and activates nothing.
//
// THE RULE. `specs/controls.md`, at the end of the keyboard section: "When
// several edges arrive on one frame, `menu-up` is applied before `menu-down`, and
// movement before `menu-confirm`: ... a frame carrying a movement edge and a
// confirm edge moves only."
//
// WHY IT IS `passable`. It is an edge case of the general rule rather than a rule
// of its own: a player who presses one key at a time never meets it, and a build
// that reads the two the other way round still answers every single edge
// correctly — `navigation/title-menu-down` and `navigation/title-menu-confirm`
// are the points that decide those.
//
// THE TITLE IS THE MENU THIS IS DRIVEN ON, because its two items confirm to two
// screens a check reads straight off `screen`: a build that applied the confirm
// as well would leave `title` for `howto` (the item the movement selected) or for
// `playing` (the item it started on), and both read as a different answer from
// the `title` this point requires.
//
// BOTH FIELDS ARE READ, because the rule has two halves and they fail
// differently: a build that dropped the movement as well as the confirm stays on
// the title with the selection it started with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  MENU_CONFIRM_KEYS,
  MENU_DOWN_KEYS,
  TITLE_HOW_TO_ITEM,
  TITLE_NEW_GAME_ITEM,
} from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressKeysInOneFrame,
  type Harness,
} from "../harness";

/** One key of each pair, delivered together on one frame. */
const CODES = [MENU_DOWN_KEYS[0], MENU_CONFIRM_KEYS[0]] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the selection and activates nothing on the same frame", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(TITLE_NEW_GAME_ITEM);
  assertEqual(
    (await h.snapshot()).menuIndex,
    TITLE_NEW_GAME_ITEM,
    "posing: menuIndex before the frame — a selection that was never posed " +
      "leaves this point nothing to move",
  );

  await pressKeysInOneFrame(h, CODES);
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a frame read the wrong way still leaves the
  // picture of the screen it reached.
  await captureStill(h, "menu");

  assertEqual(
    after.menuIndex,
    TITLE_HOW_TO_ITEM,
    `menuIndex after one frame carrying both ${CODES[0]} and ${CODES[1]} from ` +
      `menuIndex ${TITLE_NEW_GAME_ITEM} — movement is applied before ` +
      `menu-confirm, and the frame moves (specs/controls.md)`,
  );
  assertEqual(
    after.screen,
    "title",
    `the screen that frame left — a frame carrying a movement edge and a ` +
      `confirm edge moves only (specs/controls.md), so "howto" means the ` +
      `confirm was applied after the movement and "playing" means it was ` +
      `applied before it`,
  );
});
