// Refract — campaign/solved-back-choice: the solved screen's third choice
// returns to the grid.
//
// specs/modes/campaign.md: the back-to-select choice — third on the solved
// menu, two `down` presses from the arrival highlight — goes to `select`. The
// `back` action reaches the same screen by a different input, and that is
// campaign/solved-back-action's point.

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

it("the third choice goes to select", async () => {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1
  solveCampaignBoard(h, 0);
  await h.advance(1);
  assertEqual(h.snapshot().screen, "solved", "solving board 1 goes to solved");

  await tapAction(h, "down");
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "two downs highlight the third choice",
  );
  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "select");
  assertEqual(
    h.snapshot().screen,
    "select",
    "the back-to-select choice goes to select",
  );
});
