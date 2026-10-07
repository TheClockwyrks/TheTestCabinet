// instrumentation/set-menu-index — `setMenuIndex` moves the highlight of the menu
// the current screen is showing.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress: "`setMenuIndex(n)`
// | Sets the highlighted item of the menu the current screen shows, from `0` and
// below that menu's entry count." The snapshot reports it as `menuIndex`.
//
// WHAT DECIDES THAT THE HIGHLIGHT REALLY MOVED. Not the field alone — a build
// could store the number and highlight whatever it liked. `specs/ui.md` fixes what
// the highlighted item is FOR: "The item at `state.menuIndex` is highlighted and
// drawn distinctly from the others... `confirm` takes the highlighted item", and
// the title menu's three items each do something different:
//
//   `CAMPAIGN`    Sets `state.mode` to `campaign` and goes to `select`.
//   `EXTRAS`      Sets `state.mode` to `extras` and goes to `select`.
//   `HOW TO PLAY` Goes to `howto`, page `0`.
//
// THE CONFIGURATION. The title screen, whose menu is `TITLE_ITEMS`, entered fresh
// for each of its three items. Each item is posed with `setMenuIndex`, read back,
// and then TAKEN with `confirm`, and where the session lands is what says which
// item was highlighted. Three consequences, all different, so no two of them can
// be confused.
//
// THE VERDICT. Each posed index is reported, and `confirm` from it does the thing
// `specs/ui.md` gives that item and not one of the others.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights the posed item, and confirm acts on that item", async () => {
  assertEqual(
    TITLE_ITEMS.length,
    3,
    "the title menu holds the three items specs/ui.md names",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(2);
  await h.advance(1);
  await captureStill(h, "highlighted");
  assertEqual(
    (await h.snapshot()).menuIndex,
    2,
    "setMenuIndex(2) highlights the menu's third item",
  );
  await pressAction(h, "confirm");
  const third = await h.snapshot();
  assertEqual(
    third.screen,
    "howto",
    "confirm on HOW TO PLAY goes to the how-to, so that is the item that was highlighted",
  );
  assertEqual(third.howtoPage, 0, "HOW TO PLAY goes to the how-to at page 0");

  await openTitle(h);
  await h.debug.setMenuIndex(1);
  assertEqual(
    (await h.snapshot()).menuIndex,
    1,
    "setMenuIndex(1) highlights the menu's second item",
  );
  await pressAction(h, "confirm");
  const second = await h.snapshot();
  assertEqual(
    second.screen,
    "select",
    "confirm on EXTRAS goes to the select screen",
  );
  assertEqual(
    second.mode,
    "extras",
    "confirm on EXTRAS sets the mode to extras",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(0);
  assertEqual(
    (await h.snapshot()).menuIndex,
    0,
    "setMenuIndex(0) highlights the menu's first item",
  );
  await pressAction(h, "confirm");
  const first = await h.snapshot();
  assertEqual(
    first.screen,
    "select",
    "confirm on CAMPAIGN goes to the select screen",
  );
  assertEqual(
    first.mode,
    "campaign",
    "confirm on CAMPAIGN sets the mode to campaign",
  );
});
