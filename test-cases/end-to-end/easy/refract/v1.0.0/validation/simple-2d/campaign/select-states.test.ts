// Refract — campaign/select-states: one tile's own look changes when the board
// it stands for changes state.
//
// specs/modes/campaign.md: each board in the grid "shows its number and reads,
// at a glance, as one of three states" — locked, unlocked, solved — and "the
// three board states read without relying on hue alone, since none of them
// carries a channel's hue".
//
// WHAT IS COMPARED, AND WHY IT IS ONE TILE. Reading three DIFFERENT tiles
// against each other measures the digits as much as the states: board 1, board
// 2, and board 3 draw different numbers in different places. So this holds the
// tile fixed and moves the state instead. Board 2 is read three times in one
// session — locked on a fresh course, unlocked once board 1 is solved, and
// solved once board 2 itself is solved — over the SAME patch of the screen,
// and every one of the three frames is read with `selectIndex` on board 1, so
// the highlight, which is "drawn distinctly from the rest", is in exactly the
// same place on all three and cannot account for any difference between them.
// The digit, the position and the tile's geometry are identical too, so what is
// left between two readings is the state's own rendering.
//
// The highlight is held still by never moving it away rather than by parking it
// on a far tile: parking spent up to ten `right` and `down` presses per reading,
// which failed this item on a build whose `down` does not move the highlight —
// campaign/select-move-vertical's requirement, not this one's.
//
// WHY THE UNLOCKED FRAME FIXES THE REGION, AND WHY IT IS READ FIRST. The tiles'
// bounds are the build's, so the region is derived from the one thing the
// specified grid fixes: its column pitch, which the number runs give away. On
// the unlocked frame board 2 is enterable, so every build draws its number
// there; on the locked frame a build is free to mark the tile instead, and a
// region anchored on a number that is not drawn cannot be measured at all. So
// the unlocked and solved readings are taken first, the region is fixed on the
// unlocked one, and the locked reading is taken last, on a course posed fresh
// again — a fresh course being exactly what "board 2 is locked" means.
//
// THE FIGURE. Each transition must move MORE THAN 0.5% of the region's pixels
// by MORE THAN 12 of 255 in Rec. 709 luminance. Twelve of 255 is a step a
// viewer sees, and half a percent of a tile is about a glyph stroke's worth of
// ink, so a build that writes the state in a word beside an otherwise unchanged
// tile passes as readily as one that repaints the whole tile — both read at a
// glance, which is what the specification asks. A mean over the region asks
// instead how much ink a build repaints, which the specification does not fix.
// And because the measure is luminance, a build that separates the three states
// by hue at a constant brightness still fails, which is the "without relying on
// hue alone" half of the same sentence.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  resetTo,
  solveCourseBoard,
  startCampaign,
  tapAction,
  type Harness,
  type TextSpan,
} from "../harness";
import {
  changedFraction,
  gridFromSolved,
  numberRun,
  regionLuminances,
  type Region,
} from "./helpers";

/** The region's half-extent, as a share of the grid's own column pitch. */
const REGION_PITCH_SHARE = 0.45;

/** The luminance step, of 255, a pixel must move by to read as changed. */
const LUMINANCE_STEP = 12;

/** The share of the region's pixels that must move by it, of 1. */
const CHANGED_SHARE = 0.005;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Draw one frame of the screen as it stands, and read its runs of text back. */
async function drawFrame(h: Harness): Promise<TextSpan[]> {
  h.calls.length = 0;
  await h.advance(1);
  return drawnTextRuns(h);
}

/**
 * Board 2's patch of the screen, measured off the frame that drew `runs`: its
 * number's centre, and a half-extent taken from the grid's column pitch, which
 * is the distance from board 1's number to board 2's (specs/modes/campaign.md:
 * the boards are presented in number order, six columns wide).
 */
function boardTwoRegion(runs: readonly TextSpan[]): Region {
  const one = numberRun(runs, 1);
  const two = numberRun(runs, 2);
  const pitch = Math.abs(two.x - one.x);
  assertGreaterThan(
    pitch,
    0,
    "board 2's number drawn a column away from board 1's " +
      "(specs/modes/campaign.md: six columns wide, in number order)",
  );
  return { cx: two.x, cy: two.y, half: REGION_PITCH_SHARE * pitch };
}

it("board 2's tile changes as it unlocks and as it is solved", async () => {
  // UNLOCKED. A fresh course, board 1 really solved by the routes derived from
  // specs/campaign-boards.md, and back on the grid: board 2 is reached and not
  // yet solved, and the highlight rests on the board most recently solved.
  await resetTo(h);
  const fresh = await startCampaign(h);
  assertEqual(
    fresh.unlockedCount,
    1,
    "a fresh course has board 1 alone unlocked",
  );
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "playing", "board 1 opens from the grid");
  solveCourseBoard(h, 0);
  await h.advance(1);
  await gridFromSolved(h);
  const afterFirst = h.snapshot();
  assertEqual(afterFirst.unlockedCount, 2, "solving board 1 unlocks board 2");
  assertDeepEqual(
    afterFirst.solvedBoards,
    [0],
    "board 2 is unlocked and not yet solved: the state it is read in",
  );
  assertEqual(
    afterFirst.selectIndex,
    0,
    "the highlight rests on board 1, the board most recently solved " +
      "(specs/modes/campaign.md), and is read there on all three frames",
  );
  const region = boardTwoRegion(await drawFrame(h));
  const unlocked = regionLuminances(h, region);

  // SOLVED. Board 2 is entered from the same grid and solved in its turn, and
  // the highlight is walked back onto board 1 before the frame is read.
  await tapAction(h, "right");
  assertEqual(
    h.snapshot().selectIndex,
    1,
    "right moves the highlight along the row onto board 2",
  );
  await tapAction(h, "confirm");
  const playing = h.snapshot();
  assertEqual(playing.screen, "playing", "board 2, now unlocked, opens");
  assertEqual(playing.boardIndex, 1, "board 2 is the board in play");
  solveCourseBoard(h, 1);
  await h.advance(1);
  await gridFromSolved(h);
  const afterSecond = h.snapshot();
  assertDeepEqual(
    afterSecond.solvedBoards,
    [0, 1],
    "board 2 is recorded solved: the state it is read in",
  );
  await tapAction(h, "left");
  assertEqual(
    h.snapshot().selectIndex,
    0,
    "the highlight is back on board 1, where the other two frames read it",
  );
  await drawFrame(h);
  captureStill(h, "states");
  const solved = regionLuminances(h, region);

  // LOCKED. A course posed fresh again: board 1 alone is unlocked, so board 2
  // is a locked tile, in the same place on the same screen.
  await resetTo(h);
  const again = await startCampaign(h);
  assertEqual(
    again.unlockedCount,
    1,
    "the fresh course has board 1 alone unlocked, so board 2 is locked",
  );
  assertDeepEqual(again.solvedBoards, [], "and nothing is solved on it");
  assertEqual(
    again.selectIndex,
    0,
    "the highlight sits on board 1 before any board has been entered " +
      "(specs/modes/campaign.md), where the other two frames read it",
  );
  await drawFrame(h);
  const locked = regionLuminances(h, region);

  for (const [before, after, transition] of [
    [locked, unlocked, "locked to unlocked"],
    [unlocked, solved, "unlocked to solved"],
  ] as const) {
    assertGreaterThan(
      changedFraction(before, after, LUMINANCE_STEP),
      CHANGED_SHARE,
      `board 2's tile changes from ${transition}: more than ` +
        `${CHANGED_SHARE * 100}% of the region's pixels move by more than ` +
        `${LUMINANCE_STEP} of 255 in luminance, so the two states read apart ` +
        "at a glance and without relying on hue alone",
    );
  }
});
