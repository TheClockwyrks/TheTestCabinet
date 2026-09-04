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
// 2, and board 3 draw different numbers in different places, and the mean over
// a region dilutes an icon-and-border signal against that. So this holds the
// tile fixed and moves the state instead. Board 2 is read three times in one
// session — locked on the fresh course, unlocked once board 1 is solved, and
// solved once board 2 itself is solved — over the SAME patch of the screen. The
// digit, the position, and the tile's geometry are identical on all three
// frames, so what is left between two of them is the state's own rendering.
//
// THE REGION. The tiles' bounds are the build's, so the region is derived from
// the one thing the specified grid fixes: its pitch, which the number draws
// give away (six columns in number order, board 2 one column right of board 1,
// board 7 one row below it). It reaches 0.40 of the column pitch and 0.45 of
// the row pitch either way from board 2's number — wide enough to hold the
// whole of a tile that fills its cell, its border and any badge included, and
// short of the neighbouring tiles, whose states change over this session too.
// It is fixed on the FIRST frame and reused unchanged for the other two, so all
// three readings are of one patch, and each frame is only required to keep
// board 2's number inside it.
//
// THE FIGURES. Each transition must move the region by more than 6 of 441 RGB
// distance in mean colour AND by more than 4 of 255 in mean luminance. The
// colour half is the "reads as one of three states" requirement; the luminance
// half is the "without relying on hue alone" one — a build that separates the
// states by hue at a constant brightness leaves luminance flat and fails here.
// Which colours a build picks is its own business; that its tile changes is
// not.

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
  fireAction,
  solveCampaignBoard,
  startCampaign,
  textDraws,
  type Harness,
  type Rgb,
} from "../harness";
import { numberDraw } from "./reading";

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

afterEach(async () => {
  await h.dispose();
});

/** Rec. 709 luminance of a sampled colour, on the same 0..255 scale. */
function luminance(color: Rgb): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** One tile's patch of the screen, in logical units. */
interface Region {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
}

/**
 * The mean rendered colour over a region, read at EVERY device pixel in it.
 *
 * A mean over a region is only as good as its sampling: a sparse lattice
 * aliases against a tile's border — two device pixels wide is typical, and a
 * lattice stepping several pixels at a time can land on most of it or almost
 * none of it — which moves the reading by a third either way for a tile whose
 * state lives in its border. Every device pixel in the region is what makes the
 * reading the region's true mean, whatever the build draws in it.
 *
 * Read as ONE rectangle rather than as a lattice of single-pixel reads, through
 * {@link Harness.meanColor}. The reading is the same one — the same patch, the
 * same every-device-pixel mean — but a tile is around ten thousand device
 * pixels, and taken a point at a time that is ten thousand `getImageData` calls
 * and forty thousand numbers crossing out of the page, per state, three times
 * over. None of that cost is the build's: it is the host's, and on a busy host
 * it was most of what this point spent, which is how a correct build came to
 * lose the point to a timeout.
 */
async function meanRegionColor(h: Harness, region: Region): Promise<Rgb> {
  return h.meanColor({
    x0: region.cx - region.hx,
    y0: region.cy - region.hy,
    x1: region.cx + region.hx,
    y1: region.cy + region.hy,
  });
}

/**
 * Board 2's tile region, measured off the grid the current frame drew: its
 * number's anchor, and half-extents taken from the grid's column and row pitch.
 */
async function boardTwoRegion(h: Harness): Promise<Region> {
  const draws = textDraws(await h.frameCalls());
  const first = numberDraw(draws, 1);
  const second = numberDraw(draws, 2);
  const seventh = numberDraw(draws, 7);
  // specs/modes/campaign.md: the boards are presented in number order, six
  // columns wide and four rows tall, so board 2 is one column right of board 1
  // and board 7 one row below it.
  const pitchX = second.x - first.x;
  const pitchY = seventh.y - first.y;
  assertGreaterThan(
    pitchX,
    0,
    "board 2 sits to the right of board 1 in the row",
  );
  assertGreaterThan(pitchY, 0, "board 7 sits below board 1 in the next row");
  return {
    cx: second.x,
    cy: second.y,
    hx: pitchX * REGION_X,
    hy: pitchY * REGION_Y,
  };
}

/**
 * The mean colour of `region` on the frame as it stands, having confirmed that
 * board 2's number is still drawn inside it — the region is board 2's tile, and
 * a build is free to move the number about within its own tile between states.
 */
async function readRegion(
  h: Harness,
  region: Region,
  state: string,
): Promise<Rgb> {
  const second = numberDraw(textDraws(await h.frameCalls()), 2);
  assertLessThanOrEqual(
    Math.abs(second.x - region.cx),
    region.hx,
    `board 2's number is drawn inside the region read for its tile (${state})`,
  );
  assertLessThanOrEqual(
    Math.abs(second.y - region.cy),
    region.hy,
    `board 2's number is drawn inside the region read for its tile (${state})`,
  );
  return meanRegionColor(h, region);
}

/**
 * Steer the highlight onto board index `target` through the real `right` and
 * `down` actions, both of which wrap, so any board is reached from any other
 * within one lap of each. An unmet arrangement, named as one: a build whose
 * highlight will not move is failed here by the index it stopped on.
 */
async function parkHighlight(h: Harness, target: number): Promise<void> {
  for (let press = 0; press < GRID_COLS; press += 1) {
    const at = (await h.snapshot()).selectIndex;
    if (at % GRID_COLS === target % GRID_COLS) break;
    await fireAction(h, "right");
  }
  for (let press = 0; press < GRID_ROWS; press += 1) {
    const at = (await h.snapshot()).selectIndex;
    if (Math.floor(at / GRID_COLS) === Math.floor(target / GRID_COLS)) break;
    await fireAction(h, "down");
  }
  assertEqual(
    (await h.snapshot()).selectIndex,
    target,
    `the highlight parked on board ${target + 1}, clear of the tile being read`,
  );
}

it("board 2's tile changes in colour and in luminance as it unlocks and as it is solved", async () => {
  // LOCKED. A fresh course: board 1 alone is unlocked, so board 2 is a locked
  // tile (specs/modes/campaign.md).
  await startCampaign(h);
  const fresh = await h.snapshot();
  assertEqual(fresh.screen, "select", "CAMPAIGN opens the course's grid");
  assertEqual(
    fresh.unlockedCount,
    1,
    "a fresh course has board 1 alone unlocked, so board 2 is locked",
  );
  await parkHighlight(h, PARKED);
  const region = await boardTwoRegion(h);
  const locked = await readRegion(h, region, "locked");

  // UNLOCKED. Board 1 is really solved, by the routes derived from
  // specs/campaign-boards.md, and that solve unlocks board 2.
  await parkHighlight(h, 0);
  await fireAction(h, "confirm");
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "board 1 opens from the grid",
  );
  await solveCampaignBoard(h, 0);
  await fireAction(h, "back");
  const afterFirst = await h.snapshot();
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
  const unlocked = await readRegion(h, region, "unlocked");

  // SOLVED. Board 2 is entered and solved in its turn.
  await parkHighlight(h, 1);
  await fireAction(h, "confirm");
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "board 2, now unlocked, opens");
  assertEqual(playing.boardIndex, 1, "board 2 is the board in play");
  await solveCampaignBoard(h, 1);
  await fireAction(h, "back");
  const afterSecond = await h.snapshot();
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
  const solved = await readRegion(h, region, "solved");
  await captureStill(h, "states");

  for (const [before, after, transition] of [
    [locked, unlocked, "locked to unlocked"],
    [unlocked, solved, "unlocked to solved"],
  ] as const) {
    assertGreaterThan(
      colorDistance(before, after),
      COLOR_FIGURE,
      `board 2's tile region changes from ${transition} in mean colour ` +
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
