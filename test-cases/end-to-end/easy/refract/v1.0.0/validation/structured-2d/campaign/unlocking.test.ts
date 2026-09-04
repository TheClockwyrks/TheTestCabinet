// Refract — campaign/unlocking: solving a board unlocks the next, and a
// replay changes no unlock state.
//
// Board 1 is solved for real — the spec-derived route traced through the
// build's own rules — and the progression is read back off the snapshot:
// unlockedCount 2, solvedBoards holding board 1 alone (specs/modes/campaign.md:
// solving board n unlocks board n + 1; solving a board that is already solved
// changes no unlock state — it is a replay). The replay is a full second solve
// of the same board, re-entered from the grid.
//
// GETTING BACK TO THE GRID. The solve leaves the game on the solved screen,
// and specs/modes/campaign.md gives that screen two exits to `select`: its
// third menu choice, back to select, and the `back` action. This item's
// subject is on the far side of that step, not the step itself, so it must
// not pin one of the two — `gridFromSolved` takes whichever the build honours,
// and which one that is stays campaign/solved-back's verdict alone.

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

it("sets unlockedCount 2 and solvedBoards [0], and a replay changes neither", async () => {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1
  solveCampaignBoard(h, 0);
  await h.advance(1);

  const solved = h.snapshot();
  assertEqual(solved.unlockedCount, 2, "solving board 1 unlocks board 2");
  assertDeepEqual(
    solved.solvedBoards,
    [0],
    "solving board 1 records board 1 alone solved",
  );

  // The grid after the first solve.
  await gridFromSolved(h);
  await h.advance(1);
  captureStill(h, "unlocked");

  // Solve it again as a replay: re-enter board 1 from the grid and solve it
  // the same way. No unlock state changes.
  assertEqual(h.snapshot().selectIndex, 0, "the highlight sits on board 1");
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "playing", "board 1 re-entered");
  solveCampaignBoard(h, 0);
  await h.advance(1);

  const replayed = h.snapshot();
  assertEqual(replayed.unlockedCount, 2, "the replay changes no unlock count");
  assertDeepEqual(
    replayed.solvedBoards,
    [0],
    "the replay records no new solve",
  );
});
