// Refract — campaign/replay-fresh: entering a board starts it empty, replay
// or not.
//
// Board 1 is solved for real, then re-entered from the grid. The re-entered
// board must open exactly as a first attempt does: `playing`, the same board,
// every beam empty, nothing banked from the solve (specs/modes/campaign.md:
// entering a board always starts it with every beam empty, whether it is a
// first attempt or a replay; progress is per board and is never partially
// banked).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  solveCampaignBoard,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { assertBeamsEmpty } from "./support";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-enters a solved board with every beam empty, as a first attempt does", async () => {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1
  const first = h.snapshot();
  assertEqual(first.screen, "playing", "board 1 entered");
  assertBeamsEmpty(first, "the first attempt");

  solveCampaignBoard(h, 0);
  await h.advance(1);
  await tapAction(h, "back"); // solved -> select

  // Re-enter the solved board: the highlight sits on the board just solved.
  assertEqual(h.snapshot().selectIndex, 0, "the highlight sits on board 1");
  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "fresh");

  const replay = h.snapshot();
  assertEqual(replay.screen, "playing", "the solved board is re-entered");
  assertEqual(replay.boardIndex, 0, "the board re-entered is board 1");
  assertBeamsEmpty(replay, "the replay");
  assertEqual(
    replay.solved,
    false,
    "nothing of the solve is banked: the fresh board is not solved",
  );
});
