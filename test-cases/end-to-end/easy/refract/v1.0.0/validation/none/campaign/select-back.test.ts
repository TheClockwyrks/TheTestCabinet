// Refract — campaign/select-back: back on the select screen returns to the
// title.
//
// specs/modes/campaign.md, the select screen: "back returns to title."

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

it("returns to the title", async () => {
  await startCampaign(h);
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "the campaign opens on select",
  );

  await fireAction(h, "back");
  await captureStill(h, "title");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "back on select returns to title",
  );
});
