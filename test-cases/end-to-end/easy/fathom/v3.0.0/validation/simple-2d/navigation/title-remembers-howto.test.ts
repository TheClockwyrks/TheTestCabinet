// navigation/title-remembers-howto — the title comes back on HOW TO PLAY.
//
// specs/ui.md, "Returning to the title": "Confirming an item on the title menu
// records that item's index as `titleIndex` ... Every arrival at `"title"`
// selects the recorded entry: `menuIndex` becomes `titleIndex`, so each of the
// three returns above lands on the entry the player left the title from rather
// than on the first item."
//
// BOTH HALVES ARE READ, and neither alone would say the rule holds. The confirm
// has to RECORD the entry — read off `titleIndex` while the how-to screen stands
// — and the return has to RESTORE it — read off `menuIndex` back on the title. A
// build that records nothing and a build that records but never restores are
// different faults, and both fail here.
//
// THE ENTRY IS THE SECOND ONE, which is what makes the reading mean something: a
// build that simply left `titleIndex` at its opening `0` and a build that reset
// the selection on arrival both report `0`, and the entry confirmed here is `1`.
// The DIVE half of the same rule is `navigation.title-remembers-dive`, and
// between them the two cover both title entries.
//
// The selection is posed with `setMenuIndex` rather than walked with the arrow
// keys (specs/instrumentation.md), so a build with a broken `down` action fails
// `controls` and passes this. Nothing advances on `"title"` or on `"howto"`
// (specs/ui.md), so no bystander can move under the scenario.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `back` to, which leaves the how-to screen. */
const BACK_KEY = BINDINGS.back[0];

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records HOW TO PLAY on the confirm and lands on it coming back", async () => {
  openTitle(h);
  h.debug.setMenuIndex(HOWTO);
  await h.tap(CONFIRM_KEY);

  const howto = h.snapshot();
  assertEqual(
    howto.screen,
    "howto",
    "the screen HOW TO PLAY confirmed reaches",
  );
  assertEqual(
    howto.titleIndex,
    HOWTO,
    "the title menu's remembered selection after HOW TO PLAY was confirmed " +
      "there (specs/ui.md)",
  );

  await h.tap(BACK_KEY);
  const title = h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "title");

  assertEqual(title.screen, "title", "the screen `back` returns to");
  assertEqual(
    title.menuIndex,
    HOWTO,
    "the title's selection on the return, which every arrival takes from " +
      "`titleIndex` (specs/ui.md)",
  );
});
