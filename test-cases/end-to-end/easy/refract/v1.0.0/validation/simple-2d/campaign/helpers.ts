// Refract — campaign/helpers: what the campaign suites share. PRIVATE to this
// category; the shared harness poses and drives, and these READ — where each
// board's number sits in one rendered select frame, how those numbers cluster
// into rows and columns, how much of one tile's patch of the screen changed
// between two frames — plus the one arrangement several suites repeat (holding
// every beam empty).
//
// Everything here derives from specs/modes/campaign.md: the grid presents all
// CAMPAIGN_LENGTH (24) boards in number order, six columns wide and four rows
// tall, one row per set, and each board "shows its number". Nothing reads the
// build's own modules: the numbers are found among the frame's text draws
// (through the harness's recorder) and the clusters in their drawn positions,
// so the same geometry is measured the same way by every suite that needs it.
//
// THE NUMBERS ARE READ AS LOGICAL RUNS. A number is looked for among
// `drawnTextRuns`, not among the raw `fillText` calls: how a build spaces its
// letters is a font choice ("Palettes, fonts, layouts, and styling are the
// build's choices"), and letter spacing on a canvas is drawn a glyph per call,
// so a heading reading `1 OF 24 SOLVED` puts a lone `"2"` and a lone `"4"`
// among the raw draws. The runs are a PARTITION, so those glyphs sit inside
// their heading's run and no longer read as a board's number.
//
// This file, structured-2d/campaign/support.ts and none/campaign/reading.ts
// carry the same readers under the same names, with the same failure messages,
// so one condition reports identically whichever engine the build was written
// for (README.md: the three run the same scenarios and differ only in how they
// reach the build). Only `regionPixels` differs, because `none` reaches the
// pixels through the page rather than through a context it holds.

import { assertLength, fail } from "../assert";
import {
  tapAction,
  type Harness,
  type RefractSnapshot,
  type TextSpan,
} from "../harness";
import { CAMPAIGN_LENGTH } from "../notation";

/** The select grid's shape, from specs/modes/campaign.md: six by four. */
export const GRID_COLS = 6;
export const GRID_ROWS = 4;

/** Where one board's number was drawn, in logical units. */
export interface NumberPoint {
  /** The board's number, 1-based, as the grid shows it. */
  board: number;
  /** The centre of the run's horizontal extent. */
  x: number;
  /** The run's baseline. */
  y: number;
}

/**
 * Group separators a build may draw between a figure's digit triples: the
 * comma, the apostrophe, and the no-break, narrow no-break and thin spaces
 * `Number.prototype.toLocaleString` reaches for. A figure drawn with them
 * reads as the one figure it spells, because the specification fixes the VALUE
 * and leaves how that figure is presented to the build.
 *
 * ASCII space is deliberately absent from the set: a frame's text is assembled
 * by joining separate draw runs with one, so accepting it would read the two
 * figures in `"40 130"` as the single number 40130. The full stop is absent for
 * a reason of its own — it is the decimal point, and a build drawing `"1.5"`
 * means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One drawn number: a grouped figure, or a plain one. */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** The separators themselves, stripped out of a figure once matched whole. */
const SEPARATORS = new RegExp(GROUP, "g");

/**
 * The numbers a run of text carries, in order — `"1 OF 24 SOLVED"` reads
 * `[1, 24]`, and a grouped `"1,234"` reads as the single figure `1234`.
 */
function numbersIn(text: string): number[] {
  return (text.match(DRAWN) ?? []).map((figure) =>
    Number(figure.replace(SEPARATORS, "")),
  );
}

/**
 * How far apart two draws of one number sit and still read as one place.
 *
 * A build that draws one number twice in one spot is decorating it — a drop
 * shadow, an outline, a highlight pass — and a decorating pass is offset by a
 * fraction of the glyphs it decorates rather than by a tile, so the gap stands
 * well clear of any of them. It costs nothing to be generous: only ONE board's
 * matches are ever grouped, so no gap folds two boards together, and the only
 * thing a wide one risks is putting a board's point between two drawings of
 * its number that sit closer together than this — which is one tile by any
 * reading of the frame.
 */
const REDRAW_GAP = 40;

/** `matches` grouped by where they were drawn: one group per place. */
function placesOf(matches: readonly TextSpan[]): TextSpan[][] {
  const places: TextSpan[][] = [];
  for (const run of matches) {
    const x = (run.left + run.right) / 2;
    const place = places.find(
      (group) =>
        Math.abs((group[0].left + group[0].right) / 2 - x) <= REDRAW_GAP &&
        Math.abs(group[0].y - run.y) <= REDRAW_GAP,
    );
    if (place === undefined) places.push([run]);
    else place.push(run);
  }
  return places;
}

/** Where one place sits: the mean of the draws that make it up. */
function centreOf(place: readonly TextSpan[]): { x: number; y: number } {
  const x =
    place.reduce((sum, run) => sum + (run.left + run.right) / 2, 0) /
    place.length;
  const y = place.reduce((sum, run) => sum + run.y, 0) / place.length;
  return { x, y };
}

/**
 * Every place board `board`'s number was drawn in, or none at all.
 *
 * The search narrows a tier at a time, and stops at the first tier that finds
 * the number anywhere. A run that IS the number once trimmed is taken first,
 * because substring matching would put board 1 inside `"12"`. Next a run that
 * is the number written with leading zeros and nothing else, which is what
 * `"01"` is. Only when neither reads as the number on its own does the search
 * widen to a run carrying exactly one integer equal to `board`, which is what
 * `"#7"` and `"BOARD 7"` are: a label around the number is the build's own copy
 * and font choice, and specs/modes/campaign.md asks only that each board shows
 * its number. A run carrying a second board's digits, such as
 * `"1 OF 24 SOLVED"`, is not that number and stays out of every tier. A figure
 * a build groups with a thousands separator reads as the one figure it spells,
 * so a run carrying such a figure and nothing else still carries exactly one
 * number.
 *
 * The draws are grouped into places rather than returned one by one, so a
 * number drawn more than once in one spot — a shadow pass under a highlight
 * pass — is the single place it looks like.
 */
function placesForBoard(
  runs: readonly TextSpan[],
  board: number,
): TextSpan[][] {
  const bare = String(board);
  const tiers: ((run: TextSpan) => boolean)[] = [
    (run) => run.text.trim() === bare,
    (run) =>
      /^0+\d+$/.test(run.text.trim()) && Number(run.text.trim()) === board,
    (run) => {
      const figures = numbersIn(run.text);
      return figures.length === 1 && figures[0] === board;
    },
  ];
  for (const tier of tiers) {
    const matches = runs.filter(tier);
    if (matches.length > 0) return placesOf(matches);
  }
  return [];
}

/** A box around drawn positions. */
interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The box the OTHER boards' numbers were drawn in — the grid, as far as this
 * frame is unambiguous about it — or nothing, when too few of them settle on
 * one place apiece for a box to mean anything.
 */
function gridExtent(
  runs: readonly TextSpan[],
  board: number,
): Extent | undefined {
  const settled: { x: number; y: number }[] = [];
  for (let other = 1; other <= CAMPAIGN_LENGTH; other += 1) {
    if (other === board) continue;
    const places = placesForBoard(runs, other);
    if (places.length === 1) settled.push(centreOf(places[0]));
  }
  if (settled.length < 2) return undefined;
  const xs = settled.map((point) => point.x);
  const ys = settled.map((point) => point.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/** Whether a place's centre sits inside `extent`. */
function within(centre: { x: number; y: number }, extent: Extent): boolean {
  return (
    centre.x >= extent.left &&
    centre.x <= extent.right &&
    centre.y >= extent.top &&
    centre.y <= extent.bottom
  );
}

/**
 * Where board `board`'s number sits among one frame's runs of text.
 *
 * WHICH RUNS COUNT is {@link placesForBoard}'s tiers. WHICH PLACE IS THE TILE
 * is decided by the layout rather than by the spelling. The boards the frame
 * is unambiguous about are the grid, and a board's tile sits inside that grid;
 * a second drawing of the same number elsewhere on the screen does not. A
 * masthead reading `"EST. 001   /   LIGHT LAB"` carries exactly one integer
 * equal to 1, and a heading naming the highlighted board carries its number
 * again — neither is a tile, and specs/modes/campaign.md asks that each board
 * in the grid shows its number while forbidding no other copy on the screen.
 * So the frame is read for where its grid is, rather than searched for a
 * spelling that nothing else on the screen happens to share.
 *
 * Only when the layout cannot separate the candidates — two places both inside
 * the grid, each drawn as often as the other — is the frame reported as the
 * ambiguity it is, rather than averaged into a third place it never drew.
 */
export function numberRun(
  runs: readonly TextSpan[],
  board: number,
): NumberPoint {
  const places = placesForBoard(runs, board);
  if (places.length === 0) {
    fail(
      `the select frame drawing board ${board}'s number in a run of its own ` +
        "(specs/modes/campaign.md: each board in the grid shows its number; a " +
        "label or zero padding around the number is fine)",
      runs.map((run) => run.text),
    );
  }
  let candidates = places;
  if (candidates.length > 1) {
    const extent = gridExtent(runs, board);
    const inside =
      extent === undefined
        ? []
        : candidates.filter((place) => within(centreOf(place), extent));
    if (inside.length > 0) candidates = inside;
  }
  const ranked = [...candidates].sort((a, b) => b.length - a.length);
  if (ranked.length > 1 && ranked[0].length === ranked[1].length) {
    fail(
      `board ${board}'s number drawn in one place on the select frame ` +
        "(specs/modes/campaign.md: each board in the grid shows its number)",
      ranked.map((place) => {
        const centre = centreOf(place);
        return {
          text: place[0].text,
          x: Math.round(centre.x),
          y: Math.round(centre.y),
        };
      }),
    );
  }
  return { board, ...centreOf(ranked[0]) };
}
/**
 * The gap, in logical units, that separates two clusters of drawn positions.
 *
 * Numbers in one row share a baseline to within a pixel or two, and the rows
 * of a four-row grid on a 720-unit stage sit tens of units apart, so any gap
 * beyond a couple of text heights is a row (or column) boundary.
 */
const CLUSTER_GAP = 24;

/** `points` grouped along one axis: sorted, split where a gap opens. */
function clusterBy(
  points: readonly NumberPoint[],
  axis: "x" | "y",
): NumberPoint[][] {
  const sorted = [...points].sort((a, b) => a[axis] - b[axis]);
  const clusters: NumberPoint[][] = [];
  let current: NumberPoint[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const point of sorted) {
    if (current.length > 0 && point[axis] - previous > CLUSTER_GAP) {
      clusters.push(current);
      current = [];
    }
    current.push(point);
    previous = point[axis];
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/** The select grid as one frame drew it, read off the board-number runs. */
export interface SelectGrid {
  /** One point per board, 1 through 24, in number order. */
  numbers: NumberPoint[];
  /** Rows top to bottom, each sorted left to right. */
  rows: NumberPoint[][];
  /** Columns left to right, each sorted top to bottom. */
  columns: NumberPoint[][];
}

/**
 * Read the grid off one frame's runs of text. Asserts nothing beyond every
 * number being drawn: the shape checks belong to the suite that asked.
 */
export function readSelectGrid(runs: readonly TextSpan[]): SelectGrid {
  const numbers = Array.from({ length: CAMPAIGN_LENGTH }, (_, index) =>
    numberRun(runs, index + 1),
  );
  return {
    numbers,
    rows: clusterBy(numbers, "y").map((row) =>
      [...row].sort((a, b) => a.x - b.x),
    ),
    columns: clusterBy(numbers, "x").map((column) =>
      [...column].sort((a, b) => a.y - b.y),
    ),
  };
}

/** A square patch of the screen, in logical units. */
export interface Region {
  cx: number;
  cy: number;
  /** Half the square's side. */
  half: number;
}

/**
 * Every device pixel the region covers, channel by channel, in the backing
 * store's own order, so two reads of one region on two frames line up pixel for
 * pixel.
 */
export function regionPixels(h: Harness, region: Region): number[] {
  const a = h.device(region.cx - region.half, region.cy - region.half);
  const b = h.device(region.cx + region.half, region.cy + region.half);
  const { data } = h.ctx.getImageData(
    a.x,
    a.y,
    Math.max(1, b.x - a.x),
    Math.max(1, b.y - a.y),
  );
  const values: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    values.push(data[i], data[i + 1], data[i + 2]);
  }
  return values;
}

/**
 * How many of a region's channel values moved at all between two readings of
 * it. Zero means the build rendered the two states of that tile identically.
 *
 * The two readings must be of one region on one canvas, so a mismatch in length
 * is a fault in the caller, named as one.
 */
export function changedValues(
  before: readonly number[],
  after: readonly number[],
): number {
  assertLength(after, before.length, "two readings of one tile region");
  if (before.length === 0) {
    fail("a tile region covering at least one device pixel", before.length);
  }
  let changed = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (after[i] !== before[i]) changed += 1;
  }
  return changed;
}

/**
 * Every beam on the board empty, one assertion per channel present.
 *
 * The snapshot carries one entry per channel the board uses and none for a
 * channel it does not (specs/instrumentation.md), so a board with no beams to
 * read at all is an arrangement fault and named as one.
 */
export function assertBeamsEmpty(
  snapshot: RefractSnapshot,
  context: string,
): void {
  const entries = Object.entries(snapshot.beams);
  if (entries.length === 0) {
    fail(`a board with at least one channel (${context})`, snapshot.beams);
  }
  for (const [channel, beam] of entries) {
    assertLength(beam?.cells ?? [], 0, `${context}: the ${channel} beam`);
  }
}

/**
 * Leave the solved screen for the grid.
 *
 * specs/modes/campaign.md gives that screen two exits to `select`: its third
 * and last menu choice, back to select, and the `back` action. A suite that
 * only needs to be standing on the grid again must not pin one of the two —
 * WHICH of them a build honours is campaign/solved-back-choice's and
 * campaign/solved-back-action's question — so the
 * menu is walked, its third choice taken when the highlight got there, and the
 * `back` action used when it did not. A build that honours neither cannot be
 * posed onto the grid at all, and the check that needed the grid FAILS here,
 * naming the screen it stopped on: a verdict reached rather than deferred,
 * which is what a build that leaves no way off the solved screen has earned.
 */
export async function gridFromSolved(h: Harness): Promise<void> {
  if (h.snapshot().screen !== "solved") {
    fail("the solve landing on the solved screen", h.snapshot().screen);
  }
  await tapAction(h, "down");
  await tapAction(h, "down");
  await tapAction(h, h.snapshot().menuIndex === 2 ? "confirm" : "back");
  if (h.snapshot().screen !== "select") {
    fail(
      "the solved screen returning to the grid by either exit " +
        "specs/modes/campaign.md gives it",
      h.snapshot().screen,
    );
  }
}
