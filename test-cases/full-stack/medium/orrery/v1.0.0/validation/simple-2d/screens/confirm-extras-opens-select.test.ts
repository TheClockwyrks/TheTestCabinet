// screens/confirm-extras-opens-select — taking EXTRAS goes to the select screen.
//
// THE RULE, from the table `specs/ui.md` gives the title's `confirm` under
// Screens, `title`:
//
//   | Item | Does |
//   | `EXTRAS` | Sets `state.mode` to `extras` and goes to `select`. |
//
// The half decided here is the SCREEN: both title items that choose a course land
// on the same screen, which "`specs/modes/campaign.md` and
// `specs/modes/extras.md` define ... for their modes; the two share one screen
// and differ only in the list they show and the locking they apply"
// (`specs/ui.md`, Screens, `select`). What the mode is left as is
// `confirm-extras-sets-mode`'s point.
//
// THE CONFIGURATION is the title as the game opens on it, with the highlight put
// on the `EXTRAS` entry of `TITLE_ITEMS` by its index in that list rather than by
// a literal, and ONE `confirm` press. No progress is posed: the Extras "lock
// nothing" (`specs/instrumentation.md`), and the transition does not depend on
// progress in any case.
//
// THE VERDICT. The screen was `title` before the press and is `select` after it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotEqual,
} from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** Where `EXTRAS` sits in the title menu. */
const EXTRAS_ITEM = TITLE_ITEMS.indexOf("EXTRAS");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("goes to the select screen when EXTRAS is taken", async () => {
  assertGreaterThanOrEqual(
    EXTRAS_ITEM,
    0,
    "TITLE_ITEMS carries an EXTRAS entry for the confirm to take",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(EXTRAS_ITEM);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.menuIndex,
    EXTRAS_ITEM,
    `the highlight stands on the EXTRAS entry of TITLE_ITEMS (index ${EXTRAS_ITEM})`,
  );

  const after = await pressAction(h, "confirm");
  await captureStill(h, "extras-select");

  assertNotEqual(
    after.screen,
    "title",
    "confirm on EXTRAS leaves the title rather than staying on it",
  );
  assertEqual(
    after.screen,
    "select",
    "confirm on EXTRAS goes to the select screen",
  );
});
