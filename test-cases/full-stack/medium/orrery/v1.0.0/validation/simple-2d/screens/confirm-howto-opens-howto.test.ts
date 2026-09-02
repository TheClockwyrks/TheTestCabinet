// screens/confirm-howto-opens-howto — taking HOW TO PLAY opens the how-to.
//
// THE RULE, from the table `specs/ui.md` gives the title's `confirm` under
// Screens, `title`:
//
//   | Item | Does |
//   | `HOW TO PLAY` | Goes to `howto`, page `0`. |
//
// The half decided here is the SCREEN — that the third title item reaches the
// how-to at all. Which page it opens on is the how-to's own arrival rule,
// "`state.howtoPage` names the page shown, `0` on arriving", and the point that
// decides it.
//
// THE CONFIGURATION is the title as the game opens on it, with the highlight put
// on the `HOW TO PLAY` entry of `TITLE_ITEMS` by its index in that list rather
// than by a literal, and ONE `confirm` press. Nothing else is posed: unlike the
// two course items, this one chooses no mode and touches no progress.
//
// THE VERDICT. The screen was `title` before the press and is `howto` after it,
// and in particular it is not `select`, which is where the other two title items
// go.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertNotEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** Where `HOW TO PLAY` sits in the title menu. */
const HOWTO_ITEM = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("goes to the how-to when HOW TO PLAY is taken", async () => {
  assertGreaterThanOrEqual(
    HOWTO_ITEM,
    0,
    "TITLE_ITEMS carries a HOW TO PLAY entry for the confirm to take",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(HOWTO_ITEM);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.menuIndex,
    HOWTO_ITEM,
    `the highlight stands on the HOW TO PLAY entry of TITLE_ITEMS (index ${HOWTO_ITEM})`,
  );

  const after = await pressAction(h, "confirm");
  await captureStill(h, "howto");

  assertNotEqual(
    after.screen,
    "title",
    "confirm on HOW TO PLAY leaves the title rather than staying on it",
  );
  assertNotEqual(
    after.screen,
    "select",
    "HOW TO PLAY chooses no course, so it does not go where the other two items go",
  );
  assertEqual(
    after.screen,
    "howto",
    "confirm on HOW TO PLAY opens the how-to",
  );
});
