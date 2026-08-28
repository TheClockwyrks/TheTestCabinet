// Refract — campaign/unlocking: solving a board unlocks the next, and a
// replay changes no unlock state.
//
// Board 1 is really solved with the routes precomputed from
// specs/campaign-boards.md, and the unlock is read straight off the snapshot:
// unlockedCount 2 — board 2 opened by the solve — and solvedBoards holding
// board 1 alone (specs/modes/campaign.md "solving board n unlocks board
// n + 1"). The board is then entered again off the grid and solved a second
// time, and the same two fields must not have moved: "Solving a board that is
// already solved changes no unlock state. It is a replay."
//
// The still is the grid right after the first solve, where the unlock shows.

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("solving board 1 unlocks board 2, and a replay changes nothing", async () => {
  await resetTo(h);
  await startCampaign(h);

  const first = await driveCourse(h, 1);
  assertEqual(
    first.unlockedCount,
    2,
    "solving board 1 unlocks board 2 (specs/modes/campaign.md)",
  );
  assertDeepEqual(
    first.solvedBoards,
    [0],
    "board 1 alone is recorded solved (specs/modes/campaign.md)",
  );

  await tapAction(h, "back");
  assertEqual(
    h.snapshot().screen,
    "select",
    "back on the solved screen returns to the grid",
  );
  captureStill(h, "unlocked");

  // The highlight landed on board 1, so one confirm re-enters it for the
  // replay, and the same routes solve it again.
  await tapAction(h, "confirm");
  assertEqual(
    h.snapshot().screen,
    "playing",
    "board 1 re-entered for the replay",
  );
  const replay = solveCourseBoard(h, 0);
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
