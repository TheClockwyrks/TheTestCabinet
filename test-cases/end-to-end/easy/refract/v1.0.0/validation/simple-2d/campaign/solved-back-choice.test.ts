// Refract — campaign/solved-back-choice: the solved screen's third choice
// returns to the grid.
//
// Board 1 is really solved, two downs put the highlight on the third choice —
// back to select, the order is fixed even though the wording is the build's —
// and the confirm must land on select (specs/modes/campaign.md "back to
// select ... Goes to select"). The `back` action reaches the same screen by a
// different input, and that is campaign/solved-back-action's point.

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

it("the third choice goes to select", async () => {
  await resetTo(h);
  await startCampaign(h);
  await driveCourse(h, 1);

  await tapAction(h, "down");
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "two downs put the highlight on the third choice, back to select " +
      "(specs/modes/campaign.md fixes the order)",
  );
  await tapAction(h, "confirm");
  captureStill(h, "select");
  assertEqual(
    h.snapshot().screen,
    "select",
    "the back-to-select choice goes to select (specs/modes/campaign.md)",
  );
});
