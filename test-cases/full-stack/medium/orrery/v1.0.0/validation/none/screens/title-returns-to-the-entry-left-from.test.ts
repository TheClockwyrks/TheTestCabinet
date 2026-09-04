// screens/title-returns-to-the-entry-left-from — a return to the title lands on
// the entry that led away from it.
//
// THE RULE, `specs/ui.md`, Menu navigation, The remembered title selection:
// "Taking an item on the title menu sets `state.titleIndex` to that item's index
// ... Arriving at `title` from `howto` or from either select screen highlights
// the item `titleIndex` names, so a return lands on the entry that led away." The
// screens repeat the figure from their own side: leaving the how-to returns "to
// `title` with `HOW TO PLAY` highlighted" (`specs/ui.md`), and `back` on a select
// screen "returns to the title with the item that opened this mode highlighted"
// (`specs/modes/campaign.md`).
//
// THE CONFIGURATION walks it exactly as a player does, because what the rule is
// about is what TAKING an item records: the highlight is posed with
// `setMenuIndex`, `confirm` takes the item, and `back` comes home. Both ways out
// of the title are walked — `HOW TO PLAY`, which leads to the how-to, and
// `EXTRAS`, which opens a select screen — because they are the two arrivals the
// rule names, and either alone leaves a build that merely kept the last highlight
// it drew indistinguishable from one that remembers what was taken.
//
// WHY NOT `CAMPAIGN`. It is entry `0`, which is where a build that forgot the
// rule outright lands, so a return from the campaign course decides nothing.
//
// THE VERDICT. The screen is `title` after each return, with the highlight on
// `HOW TO PLAY` after the how-to and on `EXTRAS` after the Extras select screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** `HOW TO PLAY`, the entry that leads to the how-to. */
const HOWTO_ITEM = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** `EXTRAS`, the entry that opens a select screen and is not entry `0`. */
const EXTRAS_ITEM = TITLE_ITEMS.indexOf("EXTRAS");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("comes back to the title on the entry that led away from it", async () => {
  assertGreaterThan(
    HOWTO_ITEM,
    0,
    "TITLE_ITEMS carries HOW TO PLAY, and it is not entry 0",
  );
  assertGreaterThan(
    EXTRAS_ITEM,
    0,
    "TITLE_ITEMS carries EXTRAS, and it is not entry 0",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(HOWTO_ITEM);
  const opened = await pressAction(h, "confirm");
  assertEqual(
    opened.screen,
    "howto",
    "HOW TO PLAY takes the game to the how-to",
  );

  const returned = await captureReplay(h, "returned", async () => {
    const home = await pressAction(h, "back");
    await h.advance(1);
    return home;
  });
  assertEqual(returned.screen, "title", "back leaves the how-to for the title");
  assertEqual(
    returned.menuIndex,
    HOWTO_ITEM,
    "the title is entered on HOW TO PLAY, the entry that led away from it",
  );

  await h.debug.setMenuIndex(EXTRAS_ITEM);
  const listed = await pressAction(h, "confirm");
  assertEqual(
    listed.screen,
    "select",
    "EXTRAS takes the game to a select screen",
  );
  assertEqual(
    listed.mode,
    "extras",
    "the select screen it opens is the Extras",
  );

  const home = await pressAction(h, "back");
  await h.advance(1);
  assertEqual(
    home.screen,
    "title",
    "back leaves the select screen for the title",
  );
  assertEqual(
    home.menuIndex,
    EXTRAS_ITEM,
    "the title is entered on EXTRAS, the entry that opened that mode",
  );
});
