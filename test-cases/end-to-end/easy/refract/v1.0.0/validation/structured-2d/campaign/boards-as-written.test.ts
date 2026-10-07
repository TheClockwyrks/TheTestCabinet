// Refract — campaign/boards-as-written: the twenty-four boards are the ones
// specs/campaign-boards.md specifies, met in the order it lists them.
//
// The whole course is walked for real — campaign progress has no pose, so each
// board is reached by solving the one before it with the routes routes.ts
// precomputed from the specs — and every entered board is held against the
// oracle's parse of the authoritative notation: dimensions, node kinds,
// channels, and charges, nothing substituted, reordered, resized, or reworked.
//
// The walk is written out here rather than through `driveCourse`, because this
// item's evidence is a MID-COURSE board: the still must be taken at the moment
// board 13 — the first board of Set C, deep enough that a substituted course
// has had every chance to diverge — is entered, and a helper that walks the
// course whole leaves the canvas on the screen the last solve landed.
// The loop is `driveCourse`'s own, step for step.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  boardFromSnapshot,
  solveCampaignBoard,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { parseBoard, type Board, type BoardNode } from "../notation";
import { CAMPAIGN_BOARDS } from "../routes";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** A board's nodes in one fixed order, so two boards compare cell by cell. */
function sortedNodes(board: Board): BoardNode[] {
  return [...board.nodes].sort((a, b) => a.row - b.row || a.col - b.col);
}

it("meets the twenty-four specified boards, in order, exactly as written", async () => {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1 from the fresh select grid

  for (let index = 0; index < CAMPAIGN_BOARDS.length; index += 1) {
    const data = CAMPAIGN_BOARDS[index];
    const arrival = h.snapshot();
    assertEqual(arrival.screen, "playing", `entering board ${data.board}`);
    assertEqual(arrival.boardIndex, index, `board ${data.board} is up`);

    if (index === 12) {
      // A mid-course board as specified: board 13, opening Set C.
      captureStill(h, "course");
    }

    // The authoritative layout, from the oracle's parse of the notation
    // specs/campaign-boards.md writes — never from the build.
    const specified = parseBoard(data.notation);
    const entered = boardFromSnapshot(arrival);
    assertEqual(entered.cols, specified.cols, `board ${data.board}: cols`);
    assertEqual(entered.rows, specified.rows, `board ${data.board}: rows`);
    assertDeepEqual(
      sortedNodes(entered),
      sortedNodes(specified),
      `board ${data.board}: its nodes — kinds, channels, and charges — cell ` +
        `by cell`,
    );

    solveCampaignBoard(h, index);
    await h.advance(1);
    if (index < CAMPAIGN_BOARDS.length - 1) {
      // The solved screen's first choice is "next board"
      // (specs/modes/campaign.md).
      await tapAction(h, "confirm");
    }
  }
});
