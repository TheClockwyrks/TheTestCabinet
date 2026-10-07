// Refract — campaign/select-back: back on the select screen returns to the
// title, with the entry that led away highlighted.
//
// specs/modes/campaign.md, the select screen: "`back`, and taking the `back`
// target, return to `title` with `CAMPAIGN` highlighted (`menuIndex = 0`)" —
// the entry that led to the grid, as specs/ui.md has every later arrival at
// the title.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  startCampaign,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with CAMPAIGN highlighted", async () => {
  await startCampaign(h);
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "the campaign opens on select",
  );

  await fireAction(h, "back");
  await captureStill(h, "title");
  const returned = await h.snapshot();
  assertEqual(returned.screen, "title", "back on select returns to title");
  assertEqual(
    returned.menuIndex,
    0,
    "with CAMPAIGN, the entry that led away, highlighted",
  );
});
