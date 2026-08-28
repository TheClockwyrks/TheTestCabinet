// Refract — campaign/select-back: back on the select screen returns to title.
//
// One transition of the campaign's screen table (specs/modes/campaign.md: on
// `select`, `back` returns to `title`), raised through the real registered
// action and read back from the game's own screen.

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

it("returns to the title", async () => {
  await startCampaign(h);
  assertEqual(h.snapshot().screen, "select");

  await tapAction(h, "back");
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title", "back on select returns to title");
});
