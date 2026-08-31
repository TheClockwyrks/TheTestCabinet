// Floe (the strait) — specs/strait.md's geometry, and the arrangements this
// group's checks share. CASE-PROVIDED.
//
// WHY THIS GROUP WRITES ITS FIGURES OUT INSTEAD OF IMPORTING THEM. Everywhere
// else in this suite a check reads a figure from `src/constants.ts`, which is the
// exact module the build was handed and the right thing to read: the figure and
// the build cannot then disagree about what the case fixed. THIS GROUP IS THE ONE
// EXCEPTION, because `src/constants.ts` is a file in the BUILD's tree and the
// geometry is the very thing these ten items decide. A check that asked the
// build's own module where the bays are, and then held the build to that answer,
// would pass a build that moved them — the wrong figure and the wrong behaviour
// cancelling each other out — and a validator that passes on any self-consistent
// build is no validator at all.
//
// So every number below is quoted from `specs/strait.md`, and the comment beside
// it says which line of that file it is quoted from. A build that leaves
// `src/constants.ts` as it was seeded — which specs/overview.md requires: the file
// is listed under "What stays as it is" — reads back exactly these.
//
// What is imported instead is what these items are NOT about: `crossingTimer`,
// which is `specs/progression.md`'s figure and only ever sets a scenario up, and
// the shared harness's own scenario helpers.
//
// The four arrangements this group's items need, which no other group wants:
//
//   - `MEASURED_TILES` and `poseOnMeasuredTile`, the eight spread tiles the
//     tile-to-stage map is read on. Two items read one scenario — what the game
//     REPORTS the critter's centre to be, and where it DRAWS it — so the eight
//     tiles are named once, here, and both read the same eight.
//   - `poseHopUpFromWater`, the one arrangement both row-`1` items need: the
//     critter standing at a column of row `2`, ready to hop up. The bays' own
//     `poseAtBayMouth` will not serve, because these two items hop from columns no
//     bay covers as well as from ones that do.
//   - `poseLiveLanes`, a level left exactly as the game laid it out and then run,
//     which is what `median-carries-nothing` reads and what `startCrossing`
//     deliberately clears away.
//   - `bandColor`, a reading taken at a tile's centre in the space the
//     specification's own map defines rather than the build's.
//
// None of them asserts a verdict and none carries a tolerance: a check states its
// own, beside the figure it is a tolerance on.

import { crossingTimer } from "../../src/constants";
import { poseLane, sampleColor, type Harness, type Rgb } from "../harness";

/* ---- The stage, divided (specs/strait.md's region table) ------------------- */

/** `1280 x 720`: the whole stage. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** `HUD_H` (`80`): the HUD bar is `y` in `[0, 80]`, and the strait begins there. */
export const HUD_H = 80;
export const STRAIT_TOP = 80;

/* ---- The tile grid (specs/strait.md's grid paragraph) ---------------------- */

/** `TILE` (`32`), `COLS` (`40`), `ROWS` (`20`). */
export const TILE = 32;
export const COLS = 40;
export const ROWS = 20;

/* ---- The tile-to-stage map (specs/strait.md's six conversions) ------------- */

/**
 * `tileCX(c) = 32 * c + 16`, written out rather than called.
 *
 * The map is what the two map items decide, so the form of the conversion is this
 * suite's own. A build whose `tileCX` measures from a tile's edge reads sixteen
 * units left of this at every column.
 */
export function mapCX(col: number): number {
  return TILE * col + TILE / 2;
}

/** `tileCY(r) = 80 + 32 * r + 16` (specs/strait.md). */
export function mapCY(row: number): number {
  return STRAIT_TOP + TILE * row + TILE / 2;
}

/** `tileLeft(c) = 32 * c` (specs/strait.md). */
export function mapLeft(col: number): number {
  return TILE * col;
}

/* ---- The five bands (specs/strait.md's band table) ------------------------- */

/** Row `0`, `ROW_CAP`: solid far shore, full width, behind the bays. */
export const ROW_CAP = 0;
/** Row `1`, `ROW_BAYS`: solid far shore, cut by the five bays. */
export const ROW_BAYS = 1;
/** Rows `2`-`9`, `WATER_TOP`-`WATER_BOTTOM`: the water band. */
export const WATER_TOP = 2;
export const WATER_BOTTOM = 9;
/** Row `10`, `ROW_MEDIAN`: the median shelf, solid ice carrying no lane. */
export const ROW_MEDIAN = 10;
/** Rows `11`-`18`, `ICE_TOP`-`ICE_BOTTOM`: the ice band. */
export const ICE_TOP = 11;
export const ICE_BOTTOM = 18;
/** Row `19`, `ROW_NEAR`: the near shore, where a crossing begins. */
export const ROW_NEAR = 19;
/** `START_COL` (`20`): the column a crossing begins on. */
export const START_COL = 20;

/** Every row from `from` to `to` inclusive, ascending. */
function rowsBetween(from: number, to: number): readonly number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** The eight rows of the ice band, ascending: `11`-`18`. */
export const ICE_ROWS = rowsBetween(ICE_TOP, ICE_BOTTOM);

/** The eight rows of the water band, ascending: `2`-`9`. */
export const WATER_ROWS = rowsBetween(WATER_TOP, WATER_BOTTOM);

/* ---- The five bays (specs/strait.md's bay table) --------------------------- */

/** `BAYS`, left to right: bay `0` at `3`, `4`; `1` at `11`, `12`; and so on. */
export const BAY_PAIRS: readonly (readonly [number, number])[] = [
  [3, 4],
  [11, 12],
  [19, 20],
  [27, 28],
  [35, 36],
];

/** `BAY_COUNT` is `5`. */
export const BAY_COUNT = 5;

/** The ten columns the five bays cover, each with the bay it belongs to. */
export const BAY_COLUMNS: readonly { col: number; bay: number }[] =
  BAY_PAIRS.flatMap((pair, bay) => pair.map((col) => ({ col, bay })));

/** The thirty columns of row `1` no bay covers: "solid far shore". */
export const SOLID_COLUMNS: readonly number[] = Array.from(
  { length: COLS },
  (_, col) => col,
).filter((col) => !BAY_COLUMNS.some((entry) => entry.col === col));

/**
 * The centre `x` of a bay's mouth, in stage units.
 *
 * Every bay is exactly two consecutive columns wide, so the mouth spans `2 * TILE`
 * from the left column's left edge and its centre is one whole tile in from there.
 * A colour sample taken at the seam between the two columns sits `TILE` from
 * either end of the mouth, which is as far from the solid shore on either side as
 * a reading inside the mouth can be.
 */
export function bayMouthX(columns: readonly [number, number]): number {
  return mapLeft(columns[0]) + TILE;
}

/* ---- Reading the picture in the specification's own space ------------------ */

/**
 * The rendered colour at the centre of tile `(col, row)`.
 *
 * The shared harness's `sampleTile` reads through `src/constants.ts`'s own map;
 * this reads through `mapCX`/`mapCY`, so a band item samples where the
 * SPECIFICATION puts the row rather than where the build says it is.
 */
export function bandColor(h: Harness, col: number, row: number): Rgb {
  return sampleColor(h, mapCX(col), mapCY(row));
}

/**
 * The tint strait `row` is drawn in, read across the full width of the band.
 *
 * ONE READING PER COLUMN, AND THE CHANNELWISE MEDIAN OF THEM. specs/strait.md
 * makes each band one strip across the whole stage, so the reading has to be of
 * the whole strip: a tint that only holds in the middle of it is not the band
 * reading distinct, and forty samples is every tile centre of the row.
 *
 * The MEDIAN rather than the mean, because a band is a tint with the build's own
 * marking over it — a ridge tick along the shelf, a crest across the water, a
 * hairline down each lane — and a mean lets that marking stand in for the tint.
 * A build whose two safe strips are the same colour and are told apart only by a
 * few ticks would then read as two distinct bands, which is not what
 * specs/overview.md's table asks for: it asks that they "render in tints" a player
 * tells apart. A marking that covers a minority of the row's width moves a
 * minority of the readings and cannot move a median; one that covers most of it
 * has become the band's tint, and reading it as such is right.
 */
export function bandTint(h: Harness, row: number): Rgb {
  const samples = Array.from({ length: COLS }, (_, col) =>
    bandColor(h, col, row),
  );
  const middle = (of: (sample: Rgb) => number): number => {
    const sorted = samples.map(of).sort((a, b) => a - b);
    const half = sorted.length >> 1;
    return sorted.length % 2 === 0
      ? (sorted[half - 1] + sorted[half]) / 2
      : sorted[half];
  };
  return {
    r: middle((sample) => sample.r),
    g: middle((sample) => sample.g),
    b: middle((sample) => sample.b),
  };
}

/* ---- The scenarios --------------------------------------------------------- */

/** One tile of the strait, as the two map items name it. */
export interface MeasuredTile {
  col: number;
  row: number;
  /** The band it is in, for the context a failure carries. */
  band: string;
}

/**
 * The eight tiles the tile-to-stage map is measured on.
 *
 * Spread on purpose, and spread in three ways at once, because the map is one
 * formula per axis and a build gets a formula wrong in a way that shows up at the
 * extremes rather than in the middle:
 *
 *   - ACROSS THE COLUMNS. Both extreme columns, `0` and `COLS - 1`, are here, so a
 *     build whose `tileCX` is off by half a tile or measured from the stage's
 *     centre is caught rather than flattered by a mid-strait reading.
 *   - DOWN THE ROWS. The bottom row and the bay row are both here, so a build that
 *     forgot `STRAIT_TOP` in `tileTop` — the one term that separates a stage `y`
 *     from a strait `y` — reads eighty units out at every one of them.
 *   - THROUGH THE FIVE BANDS. One tile in each of the near shore, the ice band,
 *     the median, the water band and the bay row, so no band is left unread.
 *
 * The bay-row tile is a column of the middle bay: specs/strait.md makes every
 * other column of row `1` solid far shore, and a critter is only ever on that row
 * inside a bay.
 */
export const MEASURED_TILES: readonly MeasuredTile[] = [
  { col: 0, row: ROW_NEAR, band: "the near shore, leftmost column" },
  { col: COLS - 1, row: ROW_NEAR, band: "the near shore, rightmost column" },
  { col: 7, row: ICE_BOTTOM, band: "the ice band, bottom row" },
  { col: 33, row: ICE_TOP, band: "the ice band, top row" },
  { col: START_COL, row: ROW_MEDIAN, band: "the median shelf" },
  { col: 3, row: WATER_BOTTOM, band: "the water band, bottom row" },
  { col: 36, row: WATER_TOP, band: "the water band, top row" },
  {
    col: BAY_PAIRS[2][0],
    row: ROW_BAYS,
    band: "the bay row, inside the middle bay",
  },
];

/**
 * Put the critter on one of the measured tiles, and leave it able to sit there.
 *
 * `setCritterTile` alone would do for a reading taken without running a tick —
 * `tile-map` takes exactly that — but the drawn half of the same scenario has to
 * run a frame, and three of the eight tiles are in the WATER BAND, where a critter
 * whose footing is `water` falls in on that very tick (specs/water.md). So a
 * water-band tile gets the smallest floe the game has, a one-tile `pan`, laid by
 * `poseLane`, which stops the lane before it adds anything: it covers exactly the
 * tile the critter stands on and holds still.
 *
 * That floe is part of the requirement's own situation rather than a bystander
 * parked nearby — it is what makes the tile a tile a critter can be on — and it is
 * cleared away again before the next tile, so no floe from an earlier tile is left
 * on the strait.
 *
 * It poses and returns; it runs no frame.
 */
export function poseOnMeasuredTile(h: Harness, tile: MeasuredTile): void {
  h.debug.clearFloes();
  if (WATER_ROWS.includes(tile.row)) poseLane(h, tile.row, "pan", [tile.col]);
  h.debug.setCritterTile(tile.col, tile.row);
}

/**
 * Stand the critter on a still floe at column `col` of row `2`, ready to hop up.
 *
 * The one arrangement both row-`1` items need. specs/bays.md makes a crossing end
 * on "a hop up from row `2`", and row `2` is the top row of the WATER BAND
 * (specs/strait.md), so the critter cannot simply be posed at the foot of the far
 * shore: it has to be standing on a floe there, and that floe is part of the
 * requirement's situation. It is a one-tile `pan` laid by `poseLane`, so it covers
 * exactly the tile the critter stands on and the lane holds still.
 *
 * The strait is otherwise emptied and every world gate shut by `startCrossing`, so
 * the hop that follows is decided by the far shore and by nothing else.
 *
 * The critter keeps the facing, cooldown and `bestRow` it had: `setCritterTile`
 * touches none of them (specs/instrumentation.md), so the hop that follows is an
 * ordinary hop taken from row `2`.
 */
export function poseHopUpFromWater(h: Harness, col: number): void {
  poseLane(h, WATER_TOP, "pan", [col]);
  h.debug.setCritterTile(col, WATER_TOP);
}

/**
 * Lay a level out, leave its sixteen lanes exactly as the game laid them, and open
 * a live crossing over them.
 *
 * The opposite of `startCrossing`, which empties the four rosters: here the
 * traffic is the requirement rather than a bystander, because what
 * `median-carries-nothing` is about is whether a lane's items ever reach the
 * median as they run and wrap.
 *
 * The four WORLD gates are shut all the same. They are the run's own faculties
 * rather than any entity's: without them a bear emerges behind the critter and
 * joins a scenario that never asked for one, the crossing timer drains for ten
 * seconds and takes a life at the end of it, and the bonus catch arrives in a bay
 * on its own cadence. Shutting them leaves the lanes running exactly as they run
 * in play, which is the whole of what is being read.
 *
 * `reset` first, then `setLevel`, because `setLevel` re-lays the sixteen lanes by
 * design (specs/instrumentation.md), and the critter last, on the tile the caller
 * named.
 *
 * It poses and returns; it runs no frame.
 */
export function poseLiveLanes(
  h: Harness,
  col: number,
  row: number,
  level = 1,
): void {
  const { debug } = h;
  debug.reset();
  debug.setLevel(level);

  debug.setBearEmergence(false);
  debug.setCatchTest(false);
  debug.setFishCadence(false);
  debug.setTimerRunning(false);

  debug.setScreen("playing");
  debug.setPhase("crossing");
  debug.setPhaseTimer(0);
  debug.setTimer(crossingTimer(level));

  debug.addCritter(col, row);
}
