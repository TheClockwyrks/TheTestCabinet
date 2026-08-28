// Refract — campaign/solved-back: the solved screen returns to the grid, both
// ways the specification gives it.
//
// Both exits are exercised in one session. Board 1 is really solved, two
// downs put the highlight on the third choice — back to select, the order is
// fixed even though the wording is the build's — and the confirm must land on
// select. The board is then re-entered and solved again to reach the solved
// screen once more, and one real back must land on select too
// (specs/modes/campaign.md "back to select ... Goes to select", "back goes to
// select").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  resetTo,
  solveCourseBoard,
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

it("the third choice goes to select, and back on solved goes to select too", async () => {
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
  assertEqual(
    h.snapshot().screen,
    "select",
    "the back-to-select choice goes to select (specs/modes/campaign.md)",
  );
  captureStill(h, "select");

  // Reach the solved screen again — the highlight landed on board 1, so one
  // confirm re-enters it and the same routes solve it — for the back half.
  await tapAction(h, "confirm");
  assertEqual(
    h.snapshot().screen,
    "playing",
    "board 1 re-entered to reach the solved screen again",
  );
  solveCourseBoard(h, 0);
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "solved",
    "board 1 solved again, back on the solved screen",
  );

  await tapAction(h, "back");
  assertEqual(
    h.snapshot().screen,
    "select",
    "back on the solved screen goes to select as well " +
      "(specs/modes/campaign.md)",
  );
});
