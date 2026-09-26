// Refract — campaign/complete-back: back on the complete screen returns to the
// grid.
//
// specs/modes/campaign.md, the complete screen: "back goes to select". The
// menu choice that does the same is campaign/complete-to-select's point; this
// one grades the action, which is a different input on a different path.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  fireAction,
  type Harness,
} from "../harness";
import { CAMPAIGN_LENGTH } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("back on complete goes to select", async () => {
  const walk = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    walk.final.screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  await fireAction(h, "back");
  await captureStill(h, "select");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "back on complete goes to select",
  );
});
