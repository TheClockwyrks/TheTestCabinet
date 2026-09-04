// instrumentation/set-screen-select — `setScreen("select")` lands on the current
// mode's own last row.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress, in the table of
// what each name does: "`select` | Shows the current mode's select screen,
// `selectIndex` at that mode's `last`", under "Enters the screen `name`... exactly
// as the real transition into it enters it." `<mode>.last` is declared in the
// Snapshot shape as "last: <number>, // where the select screen lands", and
// `specs/modes/campaign.md` says it in the screen's own words: "On arriving at the
// screen the highlight sits on the challenge most recently entered or solved, and
// on challenge `1` before any has been entered."
//
// THE CONFIGURATION. A reset session with a DIFFERENT row posed for each mode —
// `3` for the campaign and `7` for the Extras — and the screen entered once per
// mode. Two rows rather than one, because a single figure could be read off the
// wrong mode and still match; with the two apart, the row the screen lands on says
// which mode's `last` was consulted. Each arrival is made from the title, so the
// call is a real transition rather than a re-entry.
//
// THE VERDICT. Entering the select screen in campaign mode lands the highlight on
// row `3` and entering it in extras mode lands it on row `7`, each time reporting
// the mode it was entered in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The row posed for each mode, kept apart so one cannot stand in for the other. */
const CAMPAIGN_ROW = 3;
const EXTRAS_ROW = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands selectIndex on the current mode's last row", async () => {
  await openTitle(h);
  await h.debug.setLast("campaign", CAMPAIGN_ROW);
  await h.debug.setLast("extras", EXTRAS_ROW);
  await h.debug.setMode("campaign");

  await h.debug.setScreen("select");
  const campaign = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "select");
  assertEqual(
    campaign.screen,
    "select",
    'setScreen("select") enters the select screen',
  );
  assertEqual(campaign.mode, "campaign", "the screen serves the current mode");
  assertEqual(
    campaign.selectIndex,
    CAMPAIGN_ROW,
    "a mode whose last is 3 lands on row 3",
  );

  await h.debug.setScreen("title");
  await h.debug.setMode("extras");
  await h.debug.setScreen("select");
  await h.advance(1);

  const extras = await h.snapshot();
  assertEqual(
    extras.screen,
    "select",
    'setScreen("select") enters the select screen',
  );
  assertEqual(extras.mode, "extras", "the screen serves the current mode");
  assertEqual(
    extras.selectIndex,
    EXTRAS_ROW,
    "the other mode lands on its own last rather than on the first mode's",
  );
});
