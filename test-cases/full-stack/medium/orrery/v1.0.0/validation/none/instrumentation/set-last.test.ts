// instrumentation/set-last — `setLast` sets where a select screen lands.
//
// THE RULE. "`setLast(mode, index)` — Sets the row that mode's select screen
// lands on" (`specs/instrumentation.md`, Navigation and progress), reported as
// `<mode>.last`, "where the select screen lands", and left at `0` by a reset:
// "both select screens land on their first row".
//
// WHERE IT IS OBSERVED is the transition into the screen, which the same file
// fixes: "`select` — Shows the current mode's select screen, `selectIndex` at
// that mode's `last`." `specs/modes/campaign.md` says the same in the screen's
// own terms: "On arriving at the screen the highlight sits on the challenge most
// recently entered or solved, and on challenge `1` before any has been entered."
//
// THE CONFIGURATION. A reset session with no challenge open, no machine and no
// run. A row is posed for each mode, at different indices, and each mode's select
// screen is then ARRIVED AT — `setMode` and then `setScreen("select")` — because
// `last` is read at the arrival rather than while the screen stands. The campaign
// row posed is above its unlocked count, which the rule does not mention: `last`
// is where the highlight lands, not what may be entered.
//
// THE VERDICT. Each mode reports the row posed for it, and arriving at that
// mode's select screen leaves `selectIndex` on that row.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the select screen on the row posed for its mode", async () => {
  await openTitle(h);
  assertEqual(
    (await h.snapshot()).extras.last,
    0,
    "a reset leaves both select screens landing on their first row",
  );

  await h.debug.setLast("extras", 6);
  await h.debug.setLast("campaign", 3);
  const posed = await h.snapshot();
  assertEqual(posed.extras.last, 6, "setLast(extras, 6) sets the Extras' row");
  assertEqual(
    posed.campaign.last,
    3,
    "setLast(campaign, 3) sets the campaign's row",
  );

  await openSelect(h, "extras");
  await captureStill(h, "landed");
  assertEqual(
    (await h.snapshot()).selectIndex,
    6,
    "arriving at the Extras' select screen lands selectIndex at that mode's last",
  );

  await openSelect(h, "campaign");
  assertEqual(
    (await h.snapshot()).selectIndex,
    3,
    "arriving at the campaign's select screen lands selectIndex at its own last",
  );
});
