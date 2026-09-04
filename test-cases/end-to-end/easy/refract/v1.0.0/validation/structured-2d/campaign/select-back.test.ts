// Refract — campaign/select-back: back on the select screen returns to title,
// with the entry that led away highlighted.
//
// One transition of the campaign's screen table (specs/modes/campaign.md: on
// `select`, "`back` ... return[s] to `title` with `CAMPAIGN` highlighted
// (`menuIndex = 0`)"), raised through the real registered action and read back
// from the game's own screen and highlight.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("returns to the title with CAMPAIGN highlighted", async () => {
  await startCampaign(h);
  assertEqual(h.snapshot().screen, "select");

  await tapAction(h, "back");
  await h.advance(1);
  captureStill(h, "title");

  const returned = h.snapshot();
  assertEqual(returned.screen, "title", "back on select returns to title");
  assertEqual(
    returned.menuIndex,
    0,
    "with CAMPAIGN, the entry that led away, highlighted",
  );
});
