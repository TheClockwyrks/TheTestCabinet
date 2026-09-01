// presentation/reading — how this group reads a frame's colours and its text.
//
// Only the presentation points read a frame this way, so this lives beside them
// rather than in the shared harness next door. Like everything there it fixes a
// READING alone — which pixels a comparison is taken over, and how a run of text
// is turned into a contrast — and never a THRESHOLD: every bound the points
// assert is stated in the point that asserts it, derived from the figure the
// review item fixes.
//
// NOTHING HERE KNOWS A COLOUR. specs/overview.md fixes no palette, no typeface
// and no layout: it fixes what a player must be able to READ at a glance, in a
// table of eight rows, and leaves everything else to the build. So every reading
// below compares what the build painted against what else the build painted —
// a card against the felt beside it, a heart against a spade, a pile with the
// highlight against the same pile without it — and no figure in this directory
// is a hex value.
//
// THE SCALE IS RGB DISTANCE OUT OF 441. `441` is the whole of it, `sqrt(3) * 255`,
// the distance from black to white; {@link colorDistance} in the harness is what
// measures it. Every bound the points state is on that scale.

import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  STAGE_H,
  STAGE_W,
  TABLEAU_Y,
  type Rect,
} from "../../src/constants";
import {
  colorDistance,
  pixelColor,
  sampleGrid,
  type Harness,
  type Rgb,
  type TextSpan,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Where a card is read                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How far inside its own footprint a card is read, in logical units.
 *
 * A card is a `CARD_W x CARD_H` footprint (specs/table.md) and a build is free to
 * finish its edge however it likes — an inset stroke, a rounded corner, a drop
 * shadow. None of that is what "a card reads apart from the table" is about, and
 * a corner that rounds away to felt would drag felt into a reading of the card,
 * so every card reading is taken inside this margin. It is small next to the
 * `100 x 140` footprint it insets, so what is read is still the card.
 */
const CARD_MARGIN = 8;

/** How finely a card's interior is sampled: `COLS x ROWS` points over it. */
export const CARD_COLS = 40;
export const CARD_ROWS = 56;

/** The interior of the card drawn at a top-left, as a rectangle. */
function cardInterior(x: number, y: number): Rect {
  return {
    x: x + CARD_MARGIN,
    y: y + CARD_MARGIN,
    w: CARD_W - 2 * CARD_MARGIN,
    h: CARD_H - 2 * CARD_MARGIN,
  };
}

/**
 * The colours the card drawn at a top-left was painted in, row by row.
 *
 * Two grids taken this way over two frames are directly comparable cell for cell,
 * because the grid is a function of the top-left alone: a check that poses one
 * card, reads it, poses another at the same anchor and reads that one is
 * comparing the same points of the same footprint.
 */
export function cardSamples(h: Harness, x: number, y: number): Rgb[] {
  return sampleGrid(h, cardInterior(x, y), CARD_COLS, CARD_ROWS);
}

/**
 * A lattice of one sample per whole logical unit of a rectangle.
 *
 * WHY SOME READINGS NEED THE UNIT PITCH. A grid of a few thousand cells over a
 * card samples it every two or three units, which is fine for asking what colour
 * a region comes to as a whole and wrong for asking whether a MARK is there: the
 * specification fixes no line width, so a build may draw its empty-slot outline
 * or its rank in strokes one unit wide — one device pixel at this window size —
 * and a lattice coarser than the pixel does not merely measure such a stroke
 * badly, it steps between its rows and reports a hairline mark exactly as it
 * reports no mark at all. So every reading that looks for a mark, or for the
 * difference between two marks, reads at unit pitch, which is the pitch the
 * engineless suite reads at; the three suites then hold one physical figure.
 *
 * A share of the cells is a share of the rectangle either way, so a threshold
 * stated as a share is an AREA and does not move with the pitch.
 */
export interface UnitGrid {
  /** The rectangle to sample, shifted so the cells' middles land on whole units. */
  rect: Rect;
  cols: number;
  rows: number;
  /** How many cells it holds, which is what a share of it is taken over. */
  cells: number;
}

/** The unit lattice covering `rect`: one cell per whole unit of it. */
export function unitGrid(rect: Rect): UnitGrid {
  const cols = Math.max(1, Math.round(rect.w));
  const rows = Math.max(1, Math.round(rect.h));
  return {
    rect: { x: rect.x - 0.5, y: rect.y - 0.5, w: cols, h: rows },
    cols,
    rows,
    cells: cols * rows,
  };
}

/** The colours the cells of a unit lattice were painted in, row by row. */
export function sampleUnitGrid(h: Harness, grid: UnitGrid): Rgb[] {
  return sampleGrid(h, grid.rect, grid.cols, grid.rows);
}

/**
 * A card's interior, at unit pitch, as the rank and suit points read it.
 *
 * Stated at the origin and shifted to the anchor by {@link cardFaceSamples}, so
 * the cell count a share is taken over is one figure the checks can name.
 */
export const FACE = unitGrid(cardInterior(0, 0));

/**
 * The colours the card drawn at a top-left was painted in, at unit pitch.
 *
 * Comparable cell for cell with another reading taken at the same top-left, for
 * the same reason `cardSamples` is: the lattice is a function of the top-left
 * alone.
 */
export function cardFaceSamples(h: Harness, x: number, y: number): Rgb[] {
  return sampleUnitGrid(h, unitGrid(cardInterior(x, y)));
}

/**
 * The colour a card drawn at a top-left reads as: the mean of its interior.
 *
 * The mean rather than a probe at one point, because what the legibility table
 * asks is whether the CARD reads apart from what it sits on, and a card is a
 * field of colour carrying a little ink. A single probe would read whatever
 * happened to be under it — the felt through a hole in a pattern, the middle of a
 * pip — and would decide the point on where the probe landed rather than on what
 * the player sees.
 */
export function cardColor(h: Harness, x: number, y: number): Rgb {
  return meanColor(cardSamples(h, x, y));
}

/**
 * The colour of the bare table, read between the first two tableau columns.
 *
 * specs/table.md fixes the seven columns at a pitch of `122` for a `100`-wide
 * card, and says of the `22` units left between them that "The gaps between the
 * columns carry no pile and nothing card-sized is drawn in them". So the strip
 * between column `0` and column `1`, down the height of a card from the tableau
 * anchor, is table and nothing else — and it is table right beside the card every
 * point in this group poses on column `0`, which is what "the table it sits on"
 * means.
 *
 * It is a mean over the strip rather than a probe, so a build that draws its felt
 * as a texture, a gradient or a weave reads as the colour that texture comes to
 * at a glance.
 */
export function tableColor(h: Harness): Rgb {
  const gap: Rect = {
    x: COLUMN_X[0] + CARD_W,
    y: TABLEAU_Y,
    w: COLUMN_X[1] - COLUMN_X[0] - CARD_W,
    h: CARD_H,
  };
  return meanColor(sampleGrid(h, gap, 5, CARD_ROWS));
}

/* -------------------------------------------------------------------------- */
/* Comparing what was painted                                                 */
/* -------------------------------------------------------------------------- */

/** The mean of a set of samples, channel by channel. */
export function meanColor(samples: readonly Rgb[]): Rgb {
  const total = samples.reduce(
    (sum, sample) => ({
      r: sum.r + sample.r,
      g: sum.g + sample.g,
      b: sum.b + sample.b,
    }),
    { r: 0, g: 0, b: 0 },
  );
  return {
    r: total.r / samples.length,
    g: total.g / samples.length,
    b: total.b / samples.length,
  };
}

/** The largest distance between two grids of samples, cell for cell. */
export function maxDistance(a: readonly Rgb[], b: readonly Rgb[]): number {
  let most = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    most = Math.max(most, colorDistance(a[i], b[i]));
  }
  return most;
}

/**
 * How far a MARK painted over a ground reads from that ground, where the mark
 * need only cover `share` of what was sampled.
 *
 * The reading a point takes when what it is looking for may be an outline rather
 * than a field: the distances are sorted from the furthest in, and the one at the
 * `share` position comes back — so what is reported is the distance at least that
 * share of the region reaches. A single anti-aliased pixel therefore decides
 * nothing, and a mark covering the whole region reads as that mark.
 */
export function markDistance(
  samples: readonly Rgb[],
  from: Rgb,
  share: number,
): number {
  const distances = samples
    .map((sample) => colorDistance(sample, from))
    .sort((a, b) => b - a);
  if (distances.length === 0) return 0;
  const at = Math.min(
    distances.length - 1,
    Math.floor(share * distances.length),
  );
  return distances[at];
}

/** A colour, for a failure message. */
export function showColor(colour: Rgb): string {
  return `rgb(${colour.r.toFixed(0)}, ${colour.g.toFixed(0)}, ${colour.b.toFixed(0)})`;
}

/** The largest distance from `from` to any of `samples`. */
export function maxDistanceTo(samples: readonly Rgb[], from: Rgb): number {
  return samples.reduce(
    (most, sample) => Math.max(most, colorDistance(sample, from)),
    0,
  );
}

/**
 * The cells at which two grids of the same footprint were painted differently.
 *
 * `ink` is what the caller counts as a difference rather than as the same colour
 * twice; the caller states it, because what it is worth depends on the point.
 */
export function differingCells(
  a: readonly Rgb[],
  b: readonly Rgb[],
  ink: number,
): number[] {
  const found: number[] = [];
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    if (colorDistance(a[i], b[i]) >= ink) found.push(i);
  }
  return found;
}

/**
 * The sample among `cells` that sits furthest from `from`: a card's INK, when
 * `from` is the colour the card is mostly painted in.
 *
 * A cell where one card carries ink and the other carries its plain face holds
 * the plain face on that other card's side, and the plain face is what `from` is,
 * so the furthest cell of each side is the mark that side actually drew.
 */
export function furthestFrom(
  samples: readonly Rgb[],
  cells: readonly number[],
  from: Rgb,
): Rgb {
  let best = samples[cells[0]];
  for (const cell of cells) {
    if (colorDistance(samples[cell], from) > colorDistance(best, from)) {
      best = samples[cell];
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Reading a run of text                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How tall a run of text is read as, relative to the mean width of its glyphs.
 *
 * A `TextSpan` carries where a run was anchored and how wide it measured, and
 * nothing about its height: the size and the baseline are the build's, and the
 * harness cannot see either. A run's mean advance width is the one measure of its
 * size that IS visible, and for every proportional face the cap height is a
 * little over half of it again, so half the box is set a little under two thirds
 * of the mean advance.
 *
 * The box is centred on the anchor rather than hung from it, because
 * `textBaseline` is the build's too: centred, the box lands on the glyph bodies
 * whether the anchor was their middle, their top or their baseline, and it stays
 * well inside whatever panel the build drew them on.
 */
const TEXT_HALF_HEIGHT = 0.6;

/** How finely a run of text is sampled: `COLS x ROWS` points over its box. */
const TEXT_COLS = 60;
const TEXT_ROWS = 12;

/** The box a run of text is read over, clamped to the stage. */
export function spanBox(span: TextSpan): Rect {
  const width = Math.max(span.right - span.left, 1);
  const glyphs = Math.max(span.text.length, 1);
  const half = Math.max((TEXT_HALF_HEIGHT * width) / glyphs, 1);
  const left = Math.max(0, Math.min(span.left, STAGE_W - 1));
  const right = Math.max(left + 1, Math.min(span.right, STAGE_W - 1));
  const top = Math.max(0, Math.min(span.y - half, STAGE_H - 1));
  const bottom = Math.max(top + 1, Math.min(span.y + half, STAGE_H - 1));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * How far a run of text reads from whatever it was drawn on, in RGB distance.
 *
 * The reading is taken inside the run's own box and nowhere else, because what a
 * build draws a string on is the build's: felt on one screen, a panel on another.
 * The colour the box is MOSTLY painted in is what the run sits on — glyphs cover a
 * minority of a line of text at any size — and the sample furthest from it is the
 * ink. The distance between the two is the contrast a player reads the run at.
 *
 * A build that drew the string in the colour behind it reads `0`, whatever that
 * colour was.
 */
export function spanContrast(h: Harness, span: TextSpan): number {
  const samples = sampleGrid(h, spanBox(span), TEXT_COLS, TEXT_ROWS);
  return maxDistanceTo(samples, groundColor(samples));
}

/**
 * The colour a set of samples is MOSTLY painted in.
 *
 * The most common sample, counted in buckets of {@link GROUND_BUCKET} per
 * channel so that a field of one colour is not split across the several
 * neighbouring values a renderer's dithering and anti-aliasing leave in it. The
 * bucket's own samples are then averaged, so what comes back is a colour that was
 * actually painted rather than the corner of a bucket.
 */
function groundColor(samples: readonly Rgb[]): Rgb {
  const bucket = (sample: Rgb): string =>
    [sample.r, sample.g, sample.b]
      .map((channel) => Math.floor(channel / GROUND_BUCKET))
      .join(",");
  const held = new Map<string, Rgb[]>();
  for (const sample of samples) {
    const key = bucket(sample);
    const group = held.get(key);
    if (group === undefined) held.set(key, [sample]);
    else group.push(sample);
  }
  let most: Rgb[] = samples.slice(0, 1);
  for (const group of held.values()) {
    if (group.length > most.length) most = group;
  }
  return meanColor(most);
}

/** How wide a bucket {@link groundColor} counts in is, per channel. */
const GROUND_BUCKET = 16;

/* -------------------------------------------------------------------------- */
/* Reading one point                                                          */
/* -------------------------------------------------------------------------- */

/** The colour a single logical point was painted, clamped to the stage. */
export function pointColor(h: Harness, x: number, y: number): Rgb {
  return pixelColor(
    h,
    Math.max(0, Math.min(x, STAGE_W - 1)),
    Math.max(0, Math.min(y, STAGE_H - 1)),
  );
}
