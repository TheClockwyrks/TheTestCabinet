// Refract — campaign/replay-changes-no-unlock-state: a replay changes no unlock
// state.
//
// specs/modes/campaign.md: "Solving a board that is already solved changes no
// unlock state. It is a replay." Board 1 is solved for real once — that first
// solve's effect is campaign/unlocking's point — and the replay is a full
// second solve of the same board, re-entered from the grid, after which
// unlockedCount and solvedBoards must stand exactly as they were.
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
  solveCampaignBoard,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { gridFromSolved } from "./support";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a second solve of board 1 unlocks nothing more and records nothing new", async () => {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1
  solveCampaignBoard(h, 0);
  await h.advance(1);
  await gridFromSolved(h);
  await h.advance(1);

  // Solve it again as a replay: re-enter board 1 from the grid and solve it
  // the same way. No unlock state changes.
  assertEqual(h.snapshot().selectIndex, 0, "the highlight sits on board 1");
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "playing", "board 1 re-entered");
  solveCampaignBoard(h, 0);
  await h.advance(1);
  captureStill(h, "unchanged");

  const replayed = h.snapshot();
  assertEqual(replayed.unlockedCount, 2, "the replay changes no unlock count");
  assertDeepEqual(
    replayed.solvedBoards,
    [0],
    "the replay records no new solve",
  );
});
