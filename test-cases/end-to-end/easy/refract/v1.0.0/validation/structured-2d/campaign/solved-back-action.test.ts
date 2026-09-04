// Refract — campaign/solved-back-action: back on the solved screen returns to
// the grid.
//
// specs/modes/campaign.md: the `back` action on the solved screen goes to
// `select`. The menu choice that does the same is
// campaign/solved-back-choice's point; this one grades the action, which is a
// different input on a different path.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  solveCampaignBoard,
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

it("back on the solved screen goes to select", async () => {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1
  solveCampaignBoard(h, 0);
  await h.advance(1);
  assertEqual(h.snapshot().screen, "solved", "solving board 1 goes to solved");

  await tapAction(h, "back");
  await h.advance(1);
  captureStill(h, "select");
  assertEqual(h.snapshot().screen, "select", "back on solved goes to select");
});
