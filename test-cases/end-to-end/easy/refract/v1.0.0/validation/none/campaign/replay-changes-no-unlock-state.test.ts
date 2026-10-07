// Refract — campaign/replay-changes-no-unlock-state: a replay changes no unlock
// state.
//
// specs/modes/campaign.md: "Solving a board that is already solved changes no
// unlock state. It is a replay." Board 1 is really solved once — that first
// solve's effect is campaign/unlocking's point — and then solved a second time
// from the grid, after which `unlockedCount` and `solvedBoards` must stand
// exactly as they were.
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
  fireAction,
  solveCampaignBoard,
  type Harness,
} from "../harness";
import { gridFromSolved } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("a second solve of board 1 unlocks nothing more and records nothing new", async () => {
  await driveCourse(h, 1);
  await gridFromSolved(h);

  // Replay board 1 from the grid, where the highlight landed on it.
  await fireAction(h, "confirm");
  const replay = await h.snapshot();
  assertEqual(replay.screen, "playing", "board 1 reopens for the replay");
  assertEqual(replay.boardIndex, 0, "the replay is of board 1");
  await solveCampaignBoard(h, 0);

  const after = await h.snapshot();
  await captureStill(h, "unchanged");
  assertEqual(after.unlockedCount, 2, "a replay solve changes no unlock state");
  assertDeepEqual(
    after.solvedBoards,
    [0],
    "a replay solve records nothing new",
  );
});
