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
// 2, and board 3 draw different numbers in different places, and a mean over a
// region dilutes an icon-and-border signal against that. So this holds the tile
// fixed and moves the state instead. Board 2 is read three times in one session
// — locked on the fresh course, unlocked once board 1 is solved, and solved once
// board 2 itself is solved — over the SAME patch of the screen. The digit, the
// position, and the tile's geometry are identical on all three frames, so what
// is left between two of them is the state's own rendering.
//
// THE REGION. The tiles' bounds are the build's, so the region is derived from
// the one thing the specified grid fixes: its pitch, which the number draws give
// away (six columns, four rows). It reaches 0.40 of the column pitch and 0.45 of
// the row pitch either way from board 2's number — wide enough to hold the whole
// of a tile that fills its cell, its border and any badge included, and short of
// the neighbouring tiles, whose states change over this session too. It is fixed
// on the FIRST frame and reused unchanged for the other two, so all three
// readings are of one patch, and each frame is only required to keep board 2's
// number inside it.
//
// THE FIGURES. Each transition must move the region by more than 6 of 441 RGB
// distance in mean color AND by more than 4 of 255 in mean luminance. The color
// half is the "reads as one of three states" requirement; the luminance half is
// the "without relying on hue alone" one — a build that separates the states by
// hue at a constant brightness leaves luminance flat and fails here. Which
// colors a build picks is its own business; that its tile changes is not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  resetTo,
  solveCourseBoard,
  startCampaign,
  tapAction,
  type Harness,
  type Rgb,
} from "../harness";
import {
  meanColor,
  readSelectGrid,
  requireSixByFour,
  type Region,
  type SelectGrid,
} from "./helpers";

/** The specified grid: six columns wide, four rows tall. */
const GRID_COLS = 6;
const GRID_ROWS = 4;

/**
 * Where the highlight is parked for every reading: board 7, the first board of
 * Set B. The highlight is "drawn distinctly from the rest"
 * (specs/modes/campaign.md), a fourth look on top of the three being compared,
 * so it is kept off board 2 — and on the same board every time, so it cannot
 * account for any difference between two readings either.
 */
const PARKED = 6;

/** The region's half-extents, as fractions of the grid's own pitch. */
const REGION_X = 0.4;
const REGION_Y = 0.45;

/** The change a state must make to the tile: RGB distance, of 441. */
const COLOR_FIGURE = 6;
/** And in luminance, of 255, which hue alone cannot supply. */
const LUMINANCE_FIGURE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Rec. 709 luminance of a sampled color, on the same 0..255 scale. */
function luminance(color: Rgb): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** Draw one frame of the screen as it stands, and read its grid back. */
async function drawGrid(h: Harness): Promise<SelectGrid> {
  h.calls.length = 0;
  await h.advance(1);
  const grid = readSelectGrid(h);
  requireSixByFour(grid);
  return grid;
}

/**
 * Board 2's tile region, measured off the grid one frame drew: its number's
 * center, and half-extents taken from the grid's column and row pitch.
 */
function boardTwoRegion(grid: SelectGrid): Region {
  const pitchX = (grid.colX[GRID_COLS - 1] - grid.colX[0]) / (GRID_COLS - 1);
  const pitchY = (grid.rowY[GRID_ROWS - 1] - grid.rowY[0]) / (GRID_ROWS - 1);
  const two = grid.centers[1];
  return {
    cx: two.x,
    cy: two.y,
    halfW: pitchX * REGION_X,
    halfH: pitchY * REGION_Y,
  };
}

/**
 * The mean color of `region` on the frame `grid` was read from, having
 * confirmed that board 2's number is still drawn inside it — the region is
 * board 2's tile, and a build is free to move the number about within its own
 * tile between states.
 */
function readRegion(
  h: Harness,
  grid: SelectGrid,
  region: Region,
  state: string,
): Rgb {
  const two = grid.centers[1];
  assertLessThanOrEqual(
    Math.abs(two.x - region.cx),
    region.halfW,
    `board 2's number is drawn inside the region read for its tile (${state})`,
  );
  assertLessThanOrEqual(
    Math.abs(two.y - region.cy),
    region.halfH,
    `board 2's number is drawn inside the region read for its tile (${state})`,
  );
  return meanColor(h, region.cx, region.cy, region.halfW, region.halfH);
}

/**
 * Steer the highlight onto board index `target` through the real `right` and
 * `down` actions, both of which wrap, so any board is reached from any other
 * within one lap of each. An unmet arrangement, named as one: a build whose
 * highlight will not move is failed here by the index it stopped on.
 */
async function parkHighlight(h: Harness, target: number): Promise<void> {
  for (let press = 0; press < GRID_COLS; press += 1) {
    if (h.snapshot().selectIndex % GRID_COLS === target % GRID_COLS) break;
    await tapAction(h, "right");
  }
  for (let press = 0; press < GRID_ROWS; press += 1) {
    const row = Math.floor(h.snapshot().selectIndex / GRID_COLS);
    if (row === Math.floor(target / GRID_COLS)) break;
    await tapAction(h, "down");
  }
  assertEqual(
    h.snapshot().selectIndex,
    target,
    `the highlight parked on board ${target + 1}, clear of the tile being read`,
  );
}

it("board 2's tile changes in color and in luminance as it unlocks and as it is solved", async () => {
  // LOCKED. A fresh course: board 1 alone is unlocked, so board 2 is a locked
  // tile (specs/modes/campaign.md).
  await resetTo(h);
  const fresh = await startCampaign(h);
  assertEqual(
    fresh.unlockedCount,
    1,
    "a fresh course has board 1 alone unlocked, so board 2 is locked",
  );
  await parkHighlight(h, PARKED);
  const lockedGrid = await drawGrid(h);
  const region = boardTwoRegion(lockedGrid);
  const locked = readRegion(h, lockedGrid, region, "locked");

  // UNLOCKED. Board 1 is really solved, by the routes derived from
  // specs/campaign-boards.md, and that solve unlocks board 2.
  await parkHighlight(h, 0);
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "playing", "board 1 opens from the grid");
  solveCourseBoard(h, 0);
  await h.advance(1);
  await tapAction(h, "back");
  const afterFirst = h.snapshot();
  assertEqual(
    afterFirst.screen,
    "select",
    "back on the solved screen returns the grid",
  );
  assertEqual(afterFirst.unlockedCount, 2, "solving board 1 unlocks board 2");
  assertDeepEqual(
    afterFirst.solvedBoards,
    [0],
    "board 2 is unlocked and not yet solved: the second state it is read in",
  );
  await parkHighlight(h, PARKED);
  const unlockedGrid = await drawGrid(h);
  const unlocked = readRegion(h, unlockedGrid, region, "unlocked");

  // SOLVED. Board 2 is entered and solved in its turn.
  await parkHighlight(h, 1);
  await tapAction(h, "confirm");
  const playing = h.snapshot();
  assertEqual(playing.screen, "playing", "board 2, now unlocked, opens");
  assertEqual(playing.boardIndex, 1, "board 2 is the board in play");
  solveCourseBoard(h, 1);
  await h.advance(1);
  await tapAction(h, "back");
  const afterSecond = h.snapshot();
  assertEqual(
    afterSecond.screen,
    "select",
    "back on the solved screen returns the grid",
  );
  assertDeepEqual(
    afterSecond.solvedBoards,
    [0, 1],
    "board 2 is recorded solved: the third state it is read in",
  );
  await parkHighlight(h, PARKED);
  const solvedGrid = await drawGrid(h);
  captureStill(h, "states");
  const solved = readRegion(h, solvedGrid, region, "solved");

  for (const [before, after, transition] of [
    [locked, unlocked, "locked to unlocked"],
    [unlocked, solved, "unlocked to solved"],
  ] as const) {
    assertGreaterThan(
      colorDistance(before, after),
      COLOR_FIGURE,
      `board 2's tile region changes from ${transition} in mean color ` +
        "(RGB distance, of 441), so the two states read apart at a glance",
    );
    assertGreaterThan(
      Math.abs(luminance(after) - luminance(before)),
      LUMINANCE_FIGURE,
      `board 2's tile region changes from ${transition} in mean luminance ` +
        "(of 255), so the two states read apart without relying on hue alone",
    );
  }
});
