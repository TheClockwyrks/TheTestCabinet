// Refract — campaign/solved-back: the solved screen returns to the grid, by
// its third choice and by back.
//
// specs/modes/campaign.md, the solved screen: the third choice, back to
// select, "Goes to select", and "back goes to select". Both routes are taken:
// the third choice first, then — after replaying board 1 to reach solved
// again — the back action.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  fireAction,
  solveCampaignBoard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("goes to select from the third choice, and from back", async () => {
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

  // Reach solved again through a replay, and leave it with back.
  await fireAction(h, "confirm"); // the highlight landed on board 1
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "board 1 reopens to reach solved again",
  );
  await solveCampaignBoard(h, 0);
  assertEqual(
    (await h.snapshot()).screen,
    "solved",
    "the replay solve lands on solved",
  );
  await fireAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "back on the solved screen goes to select",
  );
});
