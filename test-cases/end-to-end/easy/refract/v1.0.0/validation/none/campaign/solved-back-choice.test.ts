// Refract — campaign/solved-back-choice: the solved screen's third choice
// returns to the grid.
//
// specs/modes/campaign.md, the solved screen: the third choice, back to
// select, "Goes to select". The `back` action reaches the same screen by a
// different input, and that is campaign/solved-back-action's point.

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

it("the third choice, back to select, goes to select", async () => {
  const walk = await driveCourse(h, 1);
  assertEqual(walk.final.screen, "solved", "solving board 1 lands on solved");

  // The third choice: down twice from the arrival highlight, then confirm.
  await fireAction(h, "down");
  await fireAction(h, "down");
  await fireAction(h, "confirm");
  await captureStill(h, "select");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "the third choice, back to select, goes to select",
  );
});
