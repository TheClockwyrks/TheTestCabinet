// Refract — campaign/unlocking: solving a board unlocks the next, and a
// replay changes no unlock state.
//
// specs/modes/campaign.md: "Solving a board unlocks the next board by number:
// solving board n unlocks board n + 1", and "Solving a board that is already
// solved changes no unlock state. It is a replay." Board 1 is really solved,
// the state read back — `unlockedCount` 2, `solvedBoards` holding board 1
// alone — and then solved a second time from the grid, after which both
// fields must stand exactly as they were.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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

it("unlocks board 2 on the first solve and nothing more on the replay", async () => {
  const walk = await driveCourse(h, 1);
  assertEqual(walk.final.unlockedCount, 2, "solving board 1 unlocks board 2");
  assertDeepEqual(
    walk.final.solvedBoards,
    [0],
    "board 1 alone is recorded solved",
  );

  await fireAction(h, "back");
  await captureStill(h, "unlocked");

  // Replay board 1 from the grid, where the highlight landed on it.
  await fireAction(h, "confirm");
  const replay = await h.snapshot();
  assertEqual(replay.screen, "playing", "board 1 reopens for the replay");
  assertEqual(replay.boardIndex, 0, "the replay is of board 1");
  await solveCampaignBoard(h, 0);

  const after = await h.snapshot();
  assertEqual(after.unlockedCount, 2, "a replay solve changes no unlock state");
  assertDeepEqual(
    after.solvedBoards,
    [0],
    "a replay solve records nothing new",
  );
});
