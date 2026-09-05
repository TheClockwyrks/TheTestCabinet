// presentation — the readings the twelve points in this directory share.
//
// Nothing here asserts anything. Each function is a way of READING one frame
// the build drew, in the vocabulary `specs/assets.md` and `specs/ui.md` fix: a
// produced sprite is identified by the IDENTITY of the image drawn and its own
// natural size, and a HUD figure is read out of the runs of text the frame laid
// down. The thresholds those readings are held to live in the suites, beside
// the spec sentence each one comes from.

import { CORE_SPRITE, HUD_ICON_SPRITE, type Point } from "../constants";
import {
  distance,
  imageDraws,
  textDraws,
  type DrawCall,
  type ImageDraw,
  type TextDraw,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Produced sprites                                                           */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` fixes the canvas of every produced sprite — "core, one per
// charge | 28 x 28", "HUD cell icon | 24 x 24", "pressure icon | 24 x 24",
// "extraction flash | 6 | 48 x 48" — and "Every sprite is pixel art drawn at one
// unit per pixel". So a sprite is recognized by the NATURAL size of the source
// drawn, which is the size of the committed file, and never by a path: the same
// file reaches the page as a `data:` URI when the bundler inlines it.

/** Every image the frame drew whose source is a produced file `size` units square. */
export function spriteDraws(
  calls: readonly DrawCall[],
  size: number,
): ImageDraw[] {
  return imageDraws(calls).filter(
    (draw) => draw.image.width === size && draw.image.height === size,
  );
}

/** Every core sprite (28 x 28) the frame drew. */
export function coreDraws(calls: readonly DrawCall[]): ImageDraw[] {
  return spriteDraws(calls, CORE_SPRITE);
}

/** Every HUD icon (24 x 24) the frame drew. */
export function hudIconDraws(calls: readonly DrawCall[]): ImageDraw[] {
  return spriteDraws(calls, HUD_ICON_SPRITE);
}

/** How many times the frame drew each distinct produced source, by identity. */
export function drawCounts(draws: readonly ImageDraw[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const draw of draws) {
    counts.set(draw.image.id, (counts.get(draw.image.id) ?? 0) + 1);
  }
  return counts;
}

/**
 * The identity of the produced sprite the frame drew at `at`, or `null`.
 *
 * How a charge's own core sprite is named without reading a path: pose a core of
 * that charge, and the sprite drawn where the snapshot says that core stands is
 * the file for it. An identity is per-page, so the sprite found this way can then
 * be looked for anywhere on any later frame of the same page.
 */
export function spriteAt(
  draws: readonly ImageDraw[],
  at: Point,
  tolerance: number,
): number | null {
  let best: ImageDraw | null = null;
  for (const draw of draws) {
    const away = distance({ x: draw.cx, y: draw.cy }, at);
    if (away > tolerance) continue;
    if (best === null || away < distance({ x: best.cx, y: best.cy }, at)) {
      best = draw;
    }
  }
  return best === null ? null : best.image.id;
}

/**
 * What tells one frame of a produced sheet from the next.
 *
 * `specs/assets.md` has `draw-sheet` land a sheet "as separate files, one PNG per
 * frame", so a build that animates one usually draws a different source each
 * step and the identity alone says which frame is up. A build that packs the six
 * into one image and names a source rectangle per frame is drawing the same
 * committed frames, so the rectangle is part of the key as well.
 */
export function sheetFrameKey(draw: ImageDraw): string {
  return `${draw.image.id}:${draw.sx},${draw.sy},${draw.sw},${draw.sh}`;
}

/* -------------------------------------------------------------------------- */
/* Reading a figure off the HUD                                               */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` requires the HUD to carry the score "in digits" and "The number
// of the level in play", and fixes no font, no layout and no copy around either.
// A build is free to draw a readout as one `fillText` of "SCORE 50" or as one
// call per glyph, and both are the same picture to a player, so a check that
// only looked at the strings the frame issued would fail a perfectly good HUD
// that draws its own letterforms one at a time.
//
// So a figure is read the way a reader reads it: the runs of text a frame drew
// are grouped into the LINES they landed on and, within a line, into the words
// the spacing separates, and the digits of each word are taken as the figures the
// HUD showed. A build is free to group the digits of a long figure as it draws
// it — "1,234" is the score 1234 with the separator `toLocaleString()` puts there
// by default — so a grouped figure is read as the one figure it is.

/**
 * How far apart two glyph anchors on one line may sit and still be one word.
 *
 * A HUD that carries six readouts legibly on a 960-unit field draws them in a
 * font whose glyph advance is a small fraction of this, and it separates two
 * readouts by far more than this, so the bound sits in the gap between the two
 * with room on both sides. It only ever has to separate two DIGIT groups: a
 * label between two figures already separates them whatever the spacing.
 */
const WORD_GAP = 48;

/** How far apart two anchors may sit vertically and still be on one line. */
const LINE_GAP = 6;

/** The words a frame's text draws form, in the order they were laid down. */
export function drawnWords(calls: readonly DrawCall[]): string[] {
  const runs = [...textDraws(calls)].sort((a, b) => a.y - b.y || a.x - b.x);
  const words: string[] = [];
  let current = "";
  let previous: TextDraw | null = null;
  for (const run of runs) {
    const joins =
      previous !== null &&
      Math.abs(run.y - previous.y) <= LINE_GAP &&
      run.x - previous.x <= WORD_GAP &&
      run.x >= previous.x;
    if (!joins && current !== "") words.push(current);
    current = joins ? current + run.text : run.text;
    previous = run;
  }
  if (current !== "") words.push(current);
  return words;
}

/**
 * The marks a build may draw between the digit triples of one figure.
 *
 * `specs/ui.md` fixes the FIGURE and leaves its presentation to the build, and
 * grouping the digits of a long figure is what `Number.prototype.toLocaleString`
 * does by default, so "1,234" and "1234" are the same score drawn two ways —
 * along with the apostrophe and the narrow and non-breaking spaces other locales
 * group with. The ASCII space is deliberately not one of them: the runs a frame
 * drew are joined into words above, and taking it for a grouping mark would read
 * the two readouts of "40 130" as the single figure 40130. Neither is ".", which
 * is the decimal point — a build drawing "1.5" means one and a half.
 */
const GROUP_MARKS = [",", "'", "\u00A0", "\u202F", "\u2009"];

/** `text` as a pattern that matches exactly itself. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every conventional drawing of `value`: plain, and grouped by each mark.
 *
 * A figure of three digits or fewer has nothing to group, so it has exactly one
 * drawing and the plain reading below is the whole of it.
 */
function renderings(value: number): string[] {
  const plain = String(value);
  const [whole, fraction] = plain.split(".");
  // A break goes before every run of digit triples that reaches the end of the
  // whole part, and never at the head of the figure or after its sign.
  const broken = whole.replace(/\B(?=(?:\d{3})+$)/g, "\u0000");
  if (broken === whole) return [plain];
  const tail = fraction === undefined ? "" : `.${fraction}`;
  return [
    plain,
    ...GROUP_MARKS.map((mark) => broken.split("\u0000").join(mark) + tail),
  ];
}

/**
 * Whether `text` shows `value` as a figure of its own.
 *
 * The figure has to stand with no digit and no decimal point on either side of
 * it, so a screen showing "150" is not showing 50 and one showing "1.5" is not
 * showing 1 — the same boundary a maximal run of digits carries, held at each of
 * the ways the figure may have been grouped.
 */
function showsFigure(text: string, value: number): boolean {
  return renderings(value).some((drawn) =>
    new RegExp(`(?<![\\d.])${escapeRegExp(drawn)}(?![\\d.])`).test(text),
  );
}

/**
 * Whether the frame showed `value` as a figure of its own.
 *
 * A figure is shown when some word the frame drew holds it with nothing that
 * could be part of the same figure beside it, so a HUD reading "SCORE 50" and
 * one reading "50" both answer yes while one reading "504" does not, and a
 * figure the build grouped answers the same drawn "1,234" as drawn "1234". The
 * strings the frame issued are read the same way before they are grouped into
 * words, so a build that draws a whole readout in one call is never at the mercy
 * of that grouping.
 */
export function drewFigure(calls: readonly DrawCall[], value: number): boolean {
  // A run the frame issued carries its own word boundaries, so it is read as it
  // stands — but only when it is more than one glyph long. A build that draws a
  // readout one glyph at a time issues runs that carry no boundary at all, and
  // reading those as words would find every digit on the HUD in isolation.
  const issued = textDraws(calls)
    .map((run) => run.text)
    .filter((text) => text.trim().length > 1);
  return [...issued, ...drawnWords(calls)].some((text) =>
    showsFigure(text, value),
  );
}
