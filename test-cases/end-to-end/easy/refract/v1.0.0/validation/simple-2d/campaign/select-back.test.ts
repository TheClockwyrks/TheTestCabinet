// Refract — campaign/select-back: back on the select screen returns to the
// title.
//
// One real back on a fresh campaign's grid (specs/modes/campaign.md "back
// returns to title"). The screen is read from the snapshot, and the still
// keeps the title frame the return landed on.

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

it("back on the select screen returns to the title", async () => {
  await resetTo(h);
  await startCampaign(h);

  await tapAction(h, "back");
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "back on select returns to title (specs/modes/campaign.md)",
  );
});
