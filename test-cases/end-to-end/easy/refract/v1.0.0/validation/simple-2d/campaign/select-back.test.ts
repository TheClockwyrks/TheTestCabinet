// Refract — campaign/select-back: back on the select screen returns to the
// title, with the entry that led away highlighted.
//
// One real back on a fresh campaign's grid (specs/modes/campaign.md: "`back`,
// and taking the `back` target, return to `title` with `CAMPAIGN` highlighted
// (`menuIndex = 0`)"). The screen and the highlight are read from the
// snapshot, and the still keeps the title frame the return landed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("back on select returns to title with CAMPAIGN highlighted", async () => {
  await resetTo(h);
  await startCampaign(h);

  await tapAction(h, "back");
  captureStill(h, "title");

  const returned = h.snapshot();
  assertEqual(
    returned.screen,
    "title",
    "back on select returns to title (specs/modes/campaign.md)",
  );
  assertEqual(
    returned.menuIndex,
    0,
    "back returns with CAMPAIGN, the entry that led away, highlighted at " +
      "menuIndex 0 (specs/modes/campaign.md)",
  );
});
