// Refract — campaign/boards-as-written: the twenty-four boards are the ones
// specs/campaign-boards.md wrote, met in that order.
//
// The whole course is walked for real: each board is entered through the
// menus, held against the authoritative notation, then solved with the routes
// routes.ts precomputed from specs/campaign-boards.md under the specs/beams.md
// rules, so the next board is reached the way a player reaches it. The
// comparison re-serializes the snapshot's board through the same notation the
// specification wrote it in (specs/board.md), which covers everything the
// item names at once — dimensions, node kinds, channels, and charges — and a
// board substituted, reordered, resized, or reworked fails on the board where
// it happened, by number.
//
// The evidence still is board 13 as entered: the opening of Set C, deep
// enough into the course that a build padding the back half with invented
// boards is caught in the picture too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  solveCourseBoard,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { boardToNotation } from "../notation";
import { CAMPAIGN_BOARDS } from "../routes";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("enters all twenty-four boards in order and finds each exactly as specified", async () => {
  await resetTo(h);
  await startCampaign(h);

  for (let index = 0; index < CAMPAIGN_BOARDS.length; index += 1) {
    const data = CAMPAIGN_BOARDS[index];
    // From select the confirm enters board 1; from each solved screen it takes
    // the first choice, next board (specs/modes/campaign.md).
    await tapAction(h, "confirm");
    const entered = h.snapshot();
    assertEqual(
      entered.screen,
      "playing",
      `entering board ${data.board} goes to playing (specs/modes/campaign.md)`,
    );
    assertEqual(
      entered.boardIndex,
      index,
      `board ${data.board} sits at its own place in the course order`,
    );
    assertEqual(
      boardToNotation(oracleBoard(entered)),
      data.notation,
      `board ${data.board}: dimensions, node kinds, channels, and charges ` +
        "exactly as specs/campaign-boards.md writes them",
    );
    if (data.board === 13) captureStill(h, "course");

    solveCourseBoard(h, index);
    await h.advance(1);
  }
});
