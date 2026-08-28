// Refract — campaign/select-highlight-lands: the highlight lands on the board
// the player most recently entered or solved.
//
// The manifest's three cases, run as one session so each arrival is the real
// one: a fresh campaign arrives with the highlight on board 1 (selectIndex 0,
// "before any board has been entered it sits on board 1"); after really
// solving board 1 and returning, the highlight sits on board 1 again — the
// board most recently solved — so a solve is seen landing on the grid; and
// after entering board 2 and backing out without solving, the highlight sits
// on board 2 (selectIndex 1), the board most recently entered
// (specs/modes/campaign.md "On arriving at the screen the highlight sits on
// the board the player most recently entered or solved").

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

it("the highlight sits on the board most recently entered or solved", async () => {
  await resetTo(h);
  await startCampaign(h);
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "before any board has been entered the highlight sits on board 1 " +
      "(specs/modes/campaign.md)",
  );

  await driveCourse(h, 1);
  await tapAction(h, "back");
  const afterSolve = h.snapshot();
  assertEqual(
    afterSolve.screen,
    "select",
    "back on the solved screen returns to the grid",
  );
  assertEqual(
    afterSolve.selectIndex,
    0,
    "after solving board 1 and returning, the highlight sits on board 1 " +
      "(specs/modes/campaign.md)",
  );

  await tapAction(h, "right");
  await tapAction(h, "confirm");
  assertEqual(
    h.snapshot().screen,
    "playing",
    "board 2, unlocked by the solve, entered for the third case",
  );
  await tapAction(h, "back");
  captureStill(h, "landing");

  const afterEntry = h.snapshot();
  assertEqual(
    afterEntry.screen,
    "select",
    "back during playing returns to the grid",
  );
  assertEqual(
    afterEntry.selectIndex,
    1,
    "after entering board 2 and backing out, the highlight sits on board 2 " +
      "(specs/modes/campaign.md)",
  );
});
