// Refract — campaign/helpers: what the campaign suites share. PRIVATE to this
// category; the shared harness poses and drives, and these READ — where each
// board's number sits in one rendered select frame, how those numbers cluster
// into rows and columns, what color a tile region averages — plus the two
// small arrangements several suites repeat (walking the title highlight back
// to its first item, holding every beam empty).
//
// Everything here derives from specs/modes/campaign.md: the grid presents all
// CAMPAIGN_LENGTH (24) boards in number order, six columns wide and four rows
// tall, one row per set. Nothing reads the build's own modules: the numbers
// are found among the frame's text draws (through the harness's recorder) and
// the clusters in their drawn positions, so the same geometry is measured the
// same way by every suite that needs it.

import { assertEqual, assertLength, fail } from "../assert";
import {
  drawnTextSpans,
  tapAction,
  type Harness,
  type RefractSnapshot,
  type Rgb,
} from "../harness";
import { CAMPAIGN_LENGTH } from "../notation";

/** Where one board's number was drawn, in logical units. */
export interface GridPoint {
  /** The board's number, 1-based, as the grid shows it. */
  board: number;
  x: number;
  y: number;
}

/**
 * The gap, in logical units, that separates two clusters of drawn positions.
 *
 * Numbers in one row share a baseline to within a pixel or two, and the rows
 * of a four-row grid on a 720-unit stage sit tens of units apart, so any gap
 * beyond a couple of text heights is a row (or column) boundary.
 */
const CLUSTER_GAP = 24;

/**
 * The centre of each board number's drawn text, one point per board.
 *
 * A number is the run of text that IS that number once trimmed — substring
 * matching would put board 1 inside "12" — and a build that draws a number
 * more than once (a shadow pass, a highlight redraw) draws the passes within
 * a couple of pixels of each other, so the mean of the matches names the
 * tile's spot.
 */
export function numberCenters(h: Harness): GridPoint[] {
  const spans = drawnTextSpans(h);
  const centers: GridPoint[] = [];
  for (let board = 1; board <= CAMPAIGN_LENGTH; board += 1) {
    const matches = spans.filter((span) => span.text.trim() === String(board));
    if (matches.length === 0) {
      fail(
        `the select frame drawing the number ${board} ` +
          "(specs/modes/campaign.md: the grid presents all 24 boards, " +
          "each showing its number)",
        spans.map((span) => span.text),
      );
    }
    const x =
      matches.reduce((sum, span) => sum + (span.left + span.right) / 2, 0) /
      matches.length;
    const y = matches.reduce((sum, span) => sum + span.y, 0) / matches.length;
    centers.push({ board, x, y });
  }
  return centers;
}

/** `points` grouped along one axis: sorted, split where a gap opens. */
export function clusterBy(
  points: readonly GridPoint[],
  axis: "x" | "y",
): GridPoint[][] {
  const sorted = [...points].sort((a, b) => a[axis] - b[axis]);
  const clusters: GridPoint[][] = [];
  let current: GridPoint[] = [];
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

/** The select grid as one frame drew it, read off the number draws. */
export interface SelectGrid {
  /** One point per board, 1 through 24. */
  centers: GridPoint[];
  /** Rows top to bottom, each sorted left to right. */
  rows: GridPoint[][];
  /** The mean y of each row, top to bottom. */
  rowY: number[];
  /** Columns left to right, each sorted top to bottom. */
  columns: GridPoint[][];
  /** The mean x of each column, left to right. */
  colX: number[];
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Read the grid off the CURRENT frame's draws (clear `h.calls`, render one
 * frame, then call this). Asserts nothing beyond every number being drawn:
 * the shape checks belong to the suites. */
export function readSelectGrid(h: Harness): SelectGrid {
  const centers = numberCenters(h);
  const rows = clusterBy(centers, "y").map((row) =>
    [...row].sort((a, b) => a.x - b.x),
  );
  const columns = clusterBy(centers, "x").map((column) =>
    [...column].sort((a, b) => a.y - b.y),
  );
  return {
    centers,
    rows,
    rowY: rows.map((row) => mean(row.map((point) => point.y))),
    columns,
    colX: columns.map((column) => mean(column.map((point) => point.x))),
  };
}

/**
 * A grid that clustered into the specified six columns and four rows, for the
 * suites that MEASURE against the grid (label alignment, tile color) rather
 * than assert its shape: their precondition, named when it is unmet.
 */
export function requireSixByFour(grid: SelectGrid): void {
  if (
    grid.rows.length !== 4 ||
    grid.columns.length !== 6 ||
    grid.rows.some((row) => row.length !== 6)
  ) {
    fail(
      "the 24 board numbers clustering into six columns and four rows " +
        "(specs/modes/campaign.md), as this measurement's frame of reference",
      {
        rows: grid.rows.map((row) => row.map((point) => point.board)),
        columns: grid.columns.length,
      },
    );
  }
}

/** A logical-rectangle region, centred, with half-extents. */
export interface Region {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

/**
 * The bounding box of `board`'s number draw, in logical units: the run's
 * measured width, and its em box placed under the `textBaseline` the context
 * held at the call. This is the "tile region around the number draw" the
 * select-states item measures mean color over — the exact patch of tile the
 * number occupies, locatable on any build's layout because the number draw
 * itself names it.
 *
 * The font and baseline are read the way the anchor is: walked out of the
 * frame's recorded calls, `save`/`restore` honoured, so the em height is the
 * one the drawing context really held. A number drawn more than once (a
 * shadow pass) unions its boxes.
 */
export function numberDrawBox(h: Harness, board: number): Region {
  const view = h.engine.viewport();
  const wanted = String(board);
  interface TextState {
    font: string;
    baseline: string;
  }
  let current: TextState = { font: "", baseline: "alphabetic" };
  const stack: TextState[] = [];
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;

  for (const call of h.calls) {
    if (call.kind === "set") {
      if (call.property === "font") {
        current = { ...current, font: String(call.value) };
      } else if (call.property === "textBaseline") {
        current = { ...current, baseline: String(call.value) };
      }
      continue;
    }
    if (call.method === "save") {
      stack.push(current);
      continue;
    }
    if (call.method === "restore") {
      const restored = stack.pop();
      if (restored !== undefined) current = restored;
      continue;
    }
    if (call.text === undefined) continue;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string" || text.trim() !== wanted) continue;
    if (typeof ax !== "number" || typeof ay !== "number") continue;

    const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(current.font);
    if (sizeMatch === null) {
      fail(
        `a px font size on the context that drew the number ${board}, ` +
          "to place its em box",
        current.font,
      );
    }
    const { transform: m, width, textAlign } = call.text;
    // Device-space anchor, then back through the engine's fit, exactly as
    // drawnTextSpans reads it.
    const x = (m.a * ax + m.c * ay + m.e - view.offsetX) / view.scale;
    const y = (m.b * ax + m.d * ay + m.f - view.offsetY) / view.scale;
    const w = (width * Math.hypot(m.a, m.b)) / view.scale;
    const size = (Number(sizeMatch[1]) * Math.hypot(m.c, m.d)) / view.scale;
    const before =
      textAlign === "center"
        ? w / 2
        : textAlign === "right" || textAlign === "end"
          ? w
          : 0;
    // The em box about the baseline: how far the box reaches above the
    // anchor, per the baseline the context held.
    const above =
      current.baseline === "middle"
        ? size / 2
        : current.baseline === "top"
          ? 0
          : current.baseline === "hanging"
            ? size * 0.2
            : current.baseline === "bottom" ||
                current.baseline === "ideographic"
              ? size
              : size * 0.8; // alphabetic, the canvas default
    x0 = Math.min(x0, x - before);
    x1 = Math.max(x1, x - before + w);
    y0 = Math.min(y0, y - above);
    y1 = Math.max(y1, y - above + size);
  }

  if (!Number.isFinite(x0)) {
    fail(
      `the select frame drawing the number ${board} ` +
        "(specs/modes/campaign.md: each board in the grid shows its number)",
      "no draw of it found",
    );
  }
  return {
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    halfW: (x1 - x0) / 2,
    halfH: (y1 - y0) / 2,
  };
}

/** The mean rendered color over a logical-rectangle region. */
export function meanColor(
  h: Harness,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): Rgb {
  const a = h.device(cx - halfW, cy - halfH);
  const b = h.device(cx + halfW, cy + halfH);
  const image = h.ctx.getImageData(
    a.x,
    a.y,
    Math.max(1, b.x - a.x),
    Math.max(1, b.y - a.y),
  );
  let r = 0;
  let g = 0;
  let bl = 0;
  const pixels = image.width * image.height;
  for (let i = 0; i < image.data.length; i += 4) {
    r += image.data[i];
    g += image.data[i + 1];
    bl += image.data[i + 2];
  }
  return { r: r / pixels, g: g / pixels, b: bl / pixels };
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
 * Walk the title highlight back to its first item, CAMPAIGN.
 *
 * A fresh title arrives with its first item highlighted, but a title RETURNED
 * to may keep whatever the player last left it on, so the suites that come
 * back to the title walk the highlight up — three items, so at most two taps —
 * before the confirm that must name CAMPAIGN.
 */
export async function titleMenuToFirst(h: Harness): Promise<void> {
  for (let guard = 0; guard < 3 && h.snapshot().menuIndex !== 0; guard += 1) {
    await tapAction(h, "up");
  }
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "the title highlight walked to TITLE_ITEMS[0], CAMPAIGN (specs/ui.md)",
  );
}
