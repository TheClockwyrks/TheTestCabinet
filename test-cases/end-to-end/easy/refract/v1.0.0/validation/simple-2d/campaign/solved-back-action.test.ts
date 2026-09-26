// Refract — campaign/solved-back-action: back on the solved screen returns to
// the grid.
//
// Board 1 is really solved, and one real `back` on the solved screen must land
// on select (specs/modes/campaign.md "back goes to select"). The menu choice
// that does the same is campaign/solved-back-choice's point; this one grades
// the action, which is a different input on a different path.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
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

it("back on the solved screen goes to select", async () => {
  await resetTo(h);
  await startCampaign(h);
  const final = await driveCourse(h, 1);
  assertEqual(final.screen, "solved", "solving board 1 lands on solved");

  await tapAction(h, "back");
  captureStill(h, "select");
  assertEqual(
    h.snapshot().screen,
    "select",
    "back on the solved screen goes to select (specs/modes/campaign.md)",
  );
});
