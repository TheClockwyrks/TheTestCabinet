// screens/confirm-campaign-sets-mode — taking CAMPAIGN puts the game in campaign
// mode.
//
// THE RULE, from the table `specs/ui.md` gives the title's `confirm` under
// Screens, `title`:
//
//   | Item | Does |
//   | `CAMPAIGN` | Sets `state.mode` to `campaign` and goes to `select`. |
//
// The half decided here is the MODE, which is what the two screens downstream
// serve: "`state.mode` is `campaign` or `extras`, and decides which course the
// `select` and `editor` screens serve." Where the confirm goes is
// `confirm-campaign-opens-select`'s point.
//
// THE CONFIGURATION poses the mode AWAY from `campaign` first. A `reset`
// "restores every declared field of the game's state to its title-screen value:
// ... `mode` `campaign`" (`specs/instrumentation.md`), so a build whose `CAMPAIGN`
// item set nothing at all would sit in campaign mode already and pass a check
// that only read the field afterwards. `setMode("extras")` "Sets the course the
// select and editor screens serve", and the press is what has to set it back.
// The highlight is put on the `CAMPAIGN` entry of `TITLE_ITEMS` by its index in
// that list rather than by a literal, so the point reads the item the case names.
//
// THE VERDICT. The mode stood at `extras` with `CAMPAIGN` highlighted, and after
// one `confirm` press it is `campaign`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureReplay,
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

it("sets the mode to campaign when CAMPAIGN is taken", async () => {
  assertGreaterThanOrEqual(
    CAMPAIGN_ITEM,
    0,
    "TITLE_ITEMS carries a CAMPAIGN entry for the confirm to take",
  );

  await openTitle(h);
  await h.debug.setMode("extras");
  await h.debug.setMenuIndex(CAMPAIGN_ITEM);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.mode,
    "extras",
    "the mode is posed away from campaign, so the press is what sets it",
  );
  assertEqual(
    before.menuIndex,
    CAMPAIGN_ITEM,
    `the highlight stands on the CAMPAIGN entry of TITLE_ITEMS (index ${CAMPAIGN_ITEM})`,
  );

  const after = await captureReplay(h, "campaign-mode", () =>
    pressAction(h, "confirm"),
  );

  assertEqual(
    after.mode,
    "campaign",
    "confirm on CAMPAIGN sets the mode to campaign, so the select and editor " +
      "screens serve the course",
  );
});
