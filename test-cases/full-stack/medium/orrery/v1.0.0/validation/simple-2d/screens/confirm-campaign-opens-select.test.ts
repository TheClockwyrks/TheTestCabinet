// screens/confirm-campaign-opens-select — taking CAMPAIGN goes to the select
// screen.
//
// THE RULE, from the table `specs/ui.md` gives the title's `confirm` under
// Screens, `title`:
//
//   | Item | Does |
//   | `CAMPAIGN` | Sets `state.mode` to `campaign` and goes to `select`. |
//
// The half decided here is the SCREEN. `specs/modes/campaign.md` states the same
// transition from the mode's side: "Choosing `CAMPAIGN` on the title menu goes to
// the select screen in campaign mode." What the mode is left as is
// `confirm-campaign-sets-mode`'s point, and what the select screen then lists is
// `specs/modes/campaign.md`'s own items.
//
// THE CONFIGURATION is the title as the game opens on it, with the highlight put
// on the `CAMPAIGN` entry of `TITLE_ITEMS` by its index in that list rather than
// by a literal, and ONE `confirm` press. No progress is posed and no challenge is
// opened: the transition does not depend on either.
//
// THE VERDICT. The screen was `title` before the press and is `select` after it,
// and it is neither `title` nor `editor` nor `howto`.

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

/** Where `CAMPAIGN` sits in the title menu. */
const CAMPAIGN_ITEM = TITLE_ITEMS.indexOf("CAMPAIGN");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("goes to the select screen when CAMPAIGN is taken", async () => {
  assertGreaterThanOrEqual(
    CAMPAIGN_ITEM,
    0,
    "TITLE_ITEMS carries a CAMPAIGN entry for the confirm to take",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(CAMPAIGN_ITEM);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.menuIndex,
    CAMPAIGN_ITEM,
    `the highlight stands on the CAMPAIGN entry of TITLE_ITEMS (index ${CAMPAIGN_ITEM})`,
  );

  const after = await pressAction(h, "confirm");
  await captureStill(h, "campaign-select");

  assertNotEqual(
    after.screen,
    "title",
    "confirm on CAMPAIGN leaves the title rather than staying on it",
  );
  assertEqual(
    after.screen,
    "select",
    "confirm on CAMPAIGN goes to the select screen",
  );
});
