// Refract — campaign/solved-back-action: back on the solved screen returns to
// the grid.
//
// specs/modes/campaign.md, the solved screen: "back goes to select". The menu
// choice that does the same is campaign/solved-back-choice's point; this one
// grades the action, which is a different input on a different path.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  fireAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("back on the solved screen goes to select", async () => {
  const walk = await driveCourse(h, 1);
  assertEqual(walk.final.screen, "solved", "solving board 1 lands on solved");

  await fireAction(h, "back");
  await captureStill(h, "select");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "back on the solved screen goes to select",
  );
});
