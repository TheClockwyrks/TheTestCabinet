// Refract — campaign/replay-changes-no-unlock-state: a replay changes no unlock
// state.
//
// Board 1 is really solved once — that first solve's effect is
// campaign/unlocking's point — then entered again off the grid and solved a
// second time, and unlockedCount and solvedBoards must not have moved:
// "Solving a board that is already solved changes no unlock state. It is a
// replay." (specs/modes/campaign.md).
//
// GETTING BACK TO THE GRID. The solve leaves the game on the solved screen,
// and specs/modes/campaign.md gives that screen two exits to `select`: its
// third menu choice, back to select, and the `back` action. This item's
// subject is on the far side of that step, not the step itself, so it must
// not pin one of the two — `gridFromSolved` takes whichever the build honours,
// and which one that is stays campaign/solved-back-choice's and
// campaign/solved-back-action's verdict alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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
import { gridFromSolved } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a second solve of board 1 unlocks nothing more and records nothing new", async () => {
  await resetTo(h);
  await startCampaign(h);
  await driveCourse(h, 1);
  await gridFromSolved(h);

  // The highlight landed on board 1, so one confirm re-enters it for the
  // replay, and the same routes solve it again.
  await tapAction(h, "confirm");
  assertEqual(
    h.snapshot().screen,
    "playing",
    "board 1 re-entered for the replay",
  );
  const replay = solveCourseBoard(h, 0);
  captureStill(h, "unchanged");
  assertEqual(
    replay.unlockedCount,
    2,
    "a replay changes no unlock state (specs/modes/campaign.md)",
  );
  assertDeepEqual(
    replay.solvedBoards,
    [0],
    "a replay records no new solve (specs/modes/campaign.md)",
  );
});
