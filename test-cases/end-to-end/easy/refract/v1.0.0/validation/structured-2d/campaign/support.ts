// Refract — campaign/support: private helpers for THIS category's suites.
//
// Everything here is arrangement or reading, never verdict: reading the select
// grid's rendered number draws back into rows and columns, averaging the pixels
// of one tile's region, and steering a highlight or a menu to a known index
// through the real registered actions. Each suite states its own thresholds;
// nothing here decides a point.

import { CAMPAIGN_LENGTH } from "../notation";
import { assertDeepEqual, fail } from "../assert";
import {
  drawnTextSpans,
  tapAction,
  type Harness,
  type Rgb,
  type TextSpan,
} from "../harness";
import { CHANNELS } from "../notation";
import type { RefractSnapshot } from "../surface";

/** The select grid's shape, from specs/modes/campaign.md: six by four. */
export const GRID_COLS = 6;
export const GRID_ROWS = 4;

/**
 * Board `n`'s number draw on the current frame: the one text run whose trimmed
 * text is exactly the number. A frame that drew a number twice, or not at all,
 * cannot be read as a grid, so either fails the check that asked.
 */
export function numberSpans(h: Harness): TextSpan[] {
  const spans = drawnTextSpans(h);
  const found: TextSpan[] = [];
  for (let n = 1; n <= CAMPAIGN_LENGTH; n += 1) {
    const matches = spans.filter((span) => span.text.trim() === String(n));
    const first = matches[0];
    if (matches.length !== 1 || first === undefined) {
      fail(
        `exactly one text draw of "${n}" on the select frame ` +
          `(specs/modes/campaign.md: the grid presents all ${CAMPAIGN_LENGTH} ` +
          `boards, each showing its number)`,
        `${matches.length} draws of "${n}"`,
      );
    }
    found.push(first);
  }
  return found;
}

/** A span's horizontal center, the point a grid column is read from. */
export function spanCenterX(span: TextSpan): number {
  return (span.left + span.right) / 2;
}

/**
 * `values` split into `k` runs at the `k - 1` widest gaps, each run answered
 * by its mean — the cluster centers of a set of coordinates that is claimed to
 * fall into `k` bands. No assumption about where the bands sit, only that the
 * spacing between bands is wider than the spread within one; a set that does
 * not cluster produces centers whose per-band counts the caller's assertions
 * then refuse.
 */
export function clusterCenters(values: readonly number[], k: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < k) {
    fail(`at least ${k} coordinates to cluster`, sorted.length);
  }
  const gaps = sorted
    .slice(1)
    .map((value, i) => ({ gap: value - (sorted[i] ?? value), after: i }));
  const cuts = gaps
    .sort((a, b) => b.gap - a.gap)
    .slice(0, k - 1)
    .map((g) => g.after)
    .sort((a, b) => a - b);
  const centers: number[] = [];
  let start = 0;
  for (const end of [...cuts, sorted.length - 1]) {
    const run = sorted.slice(start, end + 1);
    centers.push(run.reduce((sum, value) => sum + value, 0) / run.length);
    start = end + 1;
  }
  return centers;
}

/** Which of `centers` lies nearest `value`. */
export function nearestIndex(
  centers: readonly number[],
  value: number,
): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  centers.forEach((center, index) => {
    const distance = Math.abs(center - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** The select grid as the frame drew it, read from the 24 number draws. */
export interface SelectGrid {
  /** `spans[n - 1]` is board `n`'s number draw. */
  spans: TextSpan[];
  /** The six column centers, in logical x, ascending. */
  columnsX: number[];
  /** The four row centers, in logical y, ascending. */
  rowsY: number[];
}

export function readSelectGrid(h: Harness): SelectGrid {
  const spans = numberSpans(h);
  return {
    spans,
    columnsX: clusterCenters(spans.map(spanCenterX), GRID_COLS),
    rowsY: clusterCenters(
      spans.map((span) => span.y),
      GRID_ROWS,
    ),
  };
}

/**
 * The mean rendered color over a logical-unit rectangle, read straight off the
 * canvas's device pixels.
 */
export function meanColorOver(
  h: Harness,
  cx: number,
  cy: number,
  width: number,
  height: number,
): Rgb {
  const a = h.device(cx - width / 2, cy - height / 2);
  const b = h.device(cx + width / 2, cy + height / 2);
  const w = Math.max(1, b.x - a.x);
  const rows = Math.max(1, b.y - a.y);
  const { data } = h.ctx.getImageData(a.x, a.y, w, rows);
  let r = 0;
  let g = 0;
  let blue = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    blue += data[i + 2];
  }
  return { r: r / pixels, g: g / pixels, b: blue / pixels };
}

/**
 * Steer the select highlight to board index `target` through the real `right`
 * and `down` actions, reading `selectIndex` back after each press. Column
 * first, then row; both wrap, so any start reaches any target within one lap
 * of each. A build whose highlight does not move under the actions cannot be
 * posed onto `target`, and the check that needed it fails here, naming the
 * index it was after — an unmet precondition, not this helper's verdict.
 */
export async function moveHighlightTo(
  h: Harness,
  target: number,
): Promise<void> {
  const targetCol = target % GRID_COLS;
  const targetRow = Math.floor(target / GRID_COLS);
  for (let presses = 0; presses <= GRID_COLS; presses += 1) {
    if (h.snapshot().selectIndex % GRID_COLS === targetCol) break;
    if (presses === GRID_COLS) {
      fail(
        `the select highlight reaching column ${targetCol} within ` +
          `${GRID_COLS} right presses (specs/modes/campaign.md: left and ` +
          `right move the highlight within its row, wrapping)`,
        h.snapshot().selectIndex,
      );
    }
    await tapAction(h, "right");
  }
  for (let presses = 0; presses <= GRID_ROWS; presses += 1) {
    if (Math.floor(h.snapshot().selectIndex / GRID_COLS) === targetRow) break;
    if (presses === GRID_ROWS) {
      fail(
        `the select highlight reaching row ${targetRow} within ` +
          `${GRID_ROWS} down presses (specs/modes/campaign.md: up and down ` +
          `move the highlight between rows, wrapping)`,
        h.snapshot().selectIndex,
      );
    }
    await tapAction(h, "down");
  }
  if (h.snapshot().selectIndex !== target) {
    fail(
      `the select highlight posed on board index ${target}`,
      h.snapshot().selectIndex,
    );
  }
}

/**
 * Steer the title menu's highlight to `target` through the real `down` action,
 * reading `menuIndex` back — for a suite that re-enters a mode after the game
 * has been elsewhere, without assuming where the highlight rested.
 */
export async function moveTitleMenuTo(
  h: Harness,
  target: number,
): Promise<void> {
  const items = 3; // TITLE_ITEMS.length, fixed by specs/ui.md.
  for (let presses = 0; presses <= items; presses += 1) {
    if (h.snapshot().menuIndex === target) return;
    if (presses === items) {
      fail(
        `the title menu highlight reaching item ${target} within ${items} ` +
          `down presses (specs/ui.md: down moves the selection, wrapping)`,
        h.snapshot().menuIndex,
      );
    }
    await tapAction(h, "down");
  }
}

/** Every beam the snapshot carries is empty. */
export function assertBeamsEmpty(
  snapshot: RefractSnapshot,
  context: string,
): void {
  for (const channel of CHANNELS) {
    const beam = snapshot.beams[channel];
    if (beam === undefined) continue;
    assertDeepEqual(beam.cells, [], `${context}: the ${channel} beam is empty`);
  }
}
