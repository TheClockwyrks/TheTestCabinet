// screens — reading what a screen actually PUT ON THE CANVAS. LOCAL TO THIS GROUP.
//
// `validation/simple-2d/harness.ts` hands every check the frame's draw calls and a
// pixel under a logical point, which is the right altitude for a shared file: they
// are atoms. What the eighteen `screens` checks need on top of them is one level
// up and wanted nowhere else in the suite, so it lives here rather than widening
// the shared file every other group agent is also editing:
//
//   * WHERE a run of text ended up, in logical field units, so "the first entry
//     above the second" is a comparison of two numbers rather than of two strings;
//   * WHETHER a piece of copy was drawn, with the three matchings the specification
//     actually calls for — a phrase inside a longer line, a standalone WORD, and a
//     NUMBER that is not part of a longer number;
//   * WHICH run belongs to WHICH menu entry, which needs care on the title menu
//     where `PLAY` is a substring of `HOW TO PLAY`;
//   * and a rectangle of the canvas read back in one go, for the one check that
//     compares how a row was painted against how the same row was painted a moment
//     later.
//
// NOTHING HERE FIXES A THRESHOLD (harness rule 2). This file says where a reading
// was taken and what it means; every bound is stated in the check that asserts it,
// beside the rule `specs/ui.md` fixes for it.

import { fail } from "../assert";
import { ACTIONS, BINDINGS, VARIANT_ACTION } from "../constants";
import {
  colorDistance,
  spelledTextRuns,
  type DrawCall,
  type Harness,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Text, and where it landed                                                  */
/* -------------------------------------------------------------------------- */

/** One run of text the frame drew, placed in the logical `1280 x 720` field. */
export interface TextRun {
  /**
   * The string the run spells, as the build passed it — concatenated, for a run
   * the build drew a call at a time.
   */
  readonly raw: string;
  /** The same string upper-cased with its runs of whitespace collapsed. */
  readonly text: string;
  /**
   * The strings of the calls that spelled the run, each {@link normalize}d, in
   * reading order; one entry for a run drawn whole.
   */
  readonly parts: readonly string[];
  /** The anchor's logical x. */
  readonly x: number;
  /** The anchor's logical y, which is the row a menu entry sits on. */
  readonly y: number;
  /** The run's left edge, in logical units, from its width and its alignment. */
  readonly left: number;
  /** Its right edge, on the same terms. */
  readonly right: number;
}

/**
 * Copy compared the way screen copy is compared: case-insensitively, and with the
 * spacing a build chose to lay it out with collapsed.
 *
 * `specs/ui.md` fixes the WORDS of every piece of screen copy and leaves the type
 * and the layout to the build, so a build that drew `Play` or padded its entry to
 * `P L A Y`'s neighbours' width has drawn the entry the specification names. Case
 * and run-length of whitespace are therefore not part of what is compared;
 * everything else is.
 */
export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Every logical run of text in the recorded calls, placed in logical field units.
 *
 * ONE ENTRY PER RUN, NOT PER CALL. `specs/ui.md` fixes the WORDS a screen shows
 * and leaves their spacing to the build, and a build that letter-spaces its title
 * or its menu entries draws one glyph per `fillText` — the only portable way to
 * letter-space canvas text. Read a call at a time, such a screen shows `S`, `H`,
 * `A`… and never the title. So the runs come off `harness.ts`'s `spelledTextRuns`,
 * which places every measured call in logical units and coalesces the
 * side-by-side glyphs on one baseline back into the string they spell; each run
 * still carries the calls that spelled it as `parts`, for {@link drawnCopy}.
 *
 * The placement is the real one: the anchor is pushed through the transform the
 * context held at the call and back out through the engine's viewport, so a
 * build that drew its menu inside a `translate`/`scale` of its own is read
 * exactly like one that did not.
 *
 * A caller reads ONE frame by clearing the call list before the advance that drew
 * it; this does no clearing of its own.
 */
export function textRuns(h: Harness, calls: readonly DrawCall[]): TextRun[] {
  return spelledTextRuns(h, calls).map((run) => ({
    raw: run.text,
    text: normalize(run.text),
    parts: run.parts.map((part) => normalize(part.text)),
    x: run.x,
    y: run.y,
    left: run.left,
    right: run.right,
  }));
}

/** Where one run ends and the next begins in {@link drawnCopy}. */
const BETWEEN_RUNS = " | ";

/** Where the runs the frame spelled end and the calls that spelled them begin. */
const BEFORE_PARTS = " || ";

/**
 * Every run the frame drew, laid end to end as one string a failure can print.
 *
 * This is the `Actual:` line of every copy check in this group: a build that drew
 * the wrong words shows the reviewer the words it did draw, beside the copy
 * `specs/ui.md` fixes. Each run is {@link normalize}d and the runs are separated
 * by a marker that appears in no piece of screen copy, so nothing matches across
 * the join.
 *
 * The runs are laid out AS THE BUILD WROTE THEM, separators and all. What a figure
 * was grouped with is {@link numberPattern}'s business, and leaving it in the string
 * is what lets the failure print the readout the reviewer would have seen.
 *
 * THE RUNS, THEN THE CALLS THAT SPELLED THEM. Coalescing glyphs into runs can
 * only add a match to a reader that matches by containment, but
 * {@link wordPattern} and {@link numberPattern} want a token standing alone, and
 * the merge can glue two runs the build set a bare space apart, in two calls,
 * into one. So after the runs, every call of a run drawn in more than one call is
 * laid out too, behind a second marker, and a token found in either is found. A
 * run drawn whole is not repeated.
 */
export function drawnCopy(runs: readonly TextRun[]): string {
  const spelled = runs.map((run) => run.text).join(BETWEEN_RUNS);
  const parts = runs
    .filter((run) => run.parts.length > 1)
    .flatMap((run) => run.parts);
  return parts.length === 0
    ? spelled
    : `${spelled}${BEFORE_PARTS}${parts.join(BETWEEN_RUNS)}`;
}

/** Every character a regular expression would otherwise read as syntax. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `word` STANDING ALONE — with no letter or digit either side of it.
 *
 * The reading `specs/ui.md` asks for where it says the how-to screen names the
 * controls "as the standalone words". `P` names a key; the `P` in `PAUSES` does
 * not, and a screen that only ever wrote `SPACE` has not named `ESC`.
 */
export function wordPattern(word: string): RegExp {
  return new RegExp(`(?<![A-Z0-9])${literal(normalize(word))}(?![A-Z0-9])`);
}

/**
 * The characters a build may GROUP a figure's digit triples with.
 *
 * `specs/ui.md` shows the score "as digits" and fixes nothing else about the
 * readout, so a build is free to hand its figure to the ordinary formatter —
 * `Number.prototype.toLocaleString`, which groups by default, with the comma, the
 * apostrophe or one of the thin and non-breaking spaces its locale calls for. Every
 * one of them writes the same number.
 *
 * AN ASCII SPACE IS NOT ONE OF THEM. {@link drawnCopy} lays the frame's runs end to
 * end, and a build that set a label and its figure as separate runs leaves a space
 * between them — so reading a space as a separator would take the two figures in
 * `40 130` for the single number `40130`.
 */
const GROUP_SEPARATORS = [",", "'", "\u00A0", "\u202F", "\u2009"];

/**
 * Every conventional writing of `value`: the bare digits, and the same digits
 * grouped into triples with each separator a build's formatter may reach for.
 *
 * A figure of three digits or fewer is grouped by nobody, so it has exactly one
 * writing and the list is the bare digits alone.
 */
function renderings(value: number): string[] {
  const plain = String(value);
  const grouped = GROUP_SEPARATORS.map((separator) =>
    plain.replace(/\B(?=(\d{3})+(?!\d))/g, separator),
  );
  return [plain, ...grouped.filter((form) => form !== plain)];
}

/**
 * `value` as a WHOLE number — the figure written out in any of its conventional
 * forms, with no further digit and no decimal point either side of it.
 *
 * `specs/ui.md` shows the score "as digits" and leaves everything else about the
 * readout to the build, so a label beside it (`SCORE 4260`) reads as the number, a
 * build that groups the same figure (`4,260`) has drawn the same number, and the
 * `13` inside `1300` is still not the number `13`.
 */
export function numberPattern(value: number): RegExp {
  const forms = renderings(value).map(literal).join("|");
  return new RegExp(`(?<![\\d.])(?:${forms})(?![\\d.])`);
}

/* -------------------------------------------------------------------------- */
/* Menu entries                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every run that shows entry `index` of `items`, and no run that shows a longer
 * entry instead.
 *
 * The exclusion is what makes the title menu readable at all: `TITLE_ITEMS` is
 * `PLAY`, `HOW TO PLAY`, so every run showing the second entry also contains the
 * first. A run is attributed to the longest entry it contains, so `HOW TO PLAY`
 * is that entry's and `PLAY` alone is the first's. A build that drew a selection
 * marker, a bullet or padding around either keeps its run: containment, not
 * equality, is the test.
 */
export function entryRuns(
  runs: readonly TextRun[],
  items: readonly string[],
  index: number,
): TextRun[] {
  const wanted = normalize(items[index]);
  const longer = items
    .map(normalize)
    .filter((other) => other !== wanted && other.includes(wanted));
  return runs.filter(
    (run) =>
      run.text.includes(wanted) &&
      !longer.some((other) => run.text.includes(other)),
  );
}

/** Where one menu entry was drawn: the extent of every run attributed to it. */
export interface EntryRow {
  /** The entry as `specs/ui.md` names it. */
  readonly item: string;
  /** The topmost anchor of its runs, in logical units. */
  readonly top: number;
  /** The bottom-most anchor of its runs. */
  readonly bottom: number;
  /** The leftmost edge of its runs. */
  readonly left: number;
  /** The rightmost edge of its runs. */
  readonly right: number;
}

/**
 * The row entry `index` was drawn on, or a failure naming the entry that was not
 * drawn at all.
 *
 * A hard read (harness rule 3): a build that drew no such entry fails HERE, naming
 * the copy `specs/ui.md` fixes and listing what it did draw, rather than crashing
 * a comparison two lines further down.
 */
export function entryRow(
  runs: readonly TextRun[],
  items: readonly string[],
  index: number,
): EntryRow {
  const mine = entryRuns(runs, items, index);
  if (mine.length === 0) {
    fail(
      `the menu entry ${JSON.stringify(items[index])} drawn on the screen ` +
        `(specs/ui.md)`,
      runs.map((run) => run.raw),
    );
  }
  return {
    item: items[index],
    top: Math.min(...mine.map((run) => run.y)),
    bottom: Math.max(...mine.map((run) => run.y)),
    left: Math.min(...mine.map((run) => run.left)),
    right: Math.max(...mine.map((run) => run.right)),
  };
}

/* -------------------------------------------------------------------------- */
/* The keys the how-to screen must name                                       */
/* -------------------------------------------------------------------------- */

/**
 * The standalone word `specs/controls.md` writes each bound key as.
 *
 * The mapping is the specification's own: the four arrow keys are named together
 * as `ARROWS` and the four letter keys of the hand position as `WASD`, and every
 * other key is named by itself.
 */
const WORD_FOR_KEY: Readonly<Record<string, string>> = {
  ArrowUp: "ARROWS",
  ArrowDown: "ARROWS",
  ArrowLeft: "ARROWS",
  ArrowRight: "ARROWS",
  KeyW: "WASD",
  KeyA: "WASD",
  KeyS: "WASD",
  KeyD: "WASD",
  Space: "SPACE",
  Enter: "ENTER",
  Escape: "ESC",
  KeyP: "P",
  KeyM: "M",
  KeyF: "F",
};

/** The standalone words `keys` spell, in order, with no repeats. */
function wordsForKeys(keys: readonly string[], into: string[]): string[] {
  for (const key of keys) {
    const word = WORD_FOR_KEY[key];
    if (word === undefined) {
      fail(
        `a key specs/controls.md names a standalone word for, one of ` +
          `${Object.keys(WORD_FOR_KEY).join(", ")}`,
        key,
      );
    }
    if (!into.includes(word)) into.push(word);
  }
  return into;
}

/**
 * Every word the how-to screen must name under EVERY variant, derived from the
 * keys `specs/controls.md` BINDS.
 *
 * Read off `../constants`'s transcription of the binding table rather than
 * written out, so the mapping above is applied once and the list is the
 * specification's rather than a second, hand-kept copy of it.
 *
 * THE VARIANT'S OWN ROW IS NOT HERE, AND IT IS NOT READ OFF THE BUILD EITHER. The
 * binding table's one variant-dependent row is `b` — `KeyF` and the torpedo under
 * `warhead`, a second `Space` for the gun under `base`, whose word `a` already
 * contributes. This list therefore always skips it, and {@link variantKeyWords} is
 * what `screens/howto-names-the-torpedo-key` asks for on the warhead checklist
 * alone. It used to be taken from whether the build reported a torpedo roster,
 * which made the requirement a function of what the build implemented: a `warhead`
 * build that never wrote the torpedo was asked for one word fewer and passed, while
 * one that wrote the torpedo and forgot to name its key failed.
 */
export function boundKeyWords(): string[] {
  const words: string[] = [];
  for (const action of ACTIONS) {
    if (action === VARIANT_ACTION) continue;
    wordsForKeys(BINDINGS[action].keys, words);
  }
  return words;
}

/**
 * The word (or words) the variant's own binding row spells: `F`, for the torpedo.
 *
 * `specs/controls.md` binds `b` to `KeyF` under `warhead`, and `../constants`
 * carries that key unconditionally for the reason its own comment gives. Only the
 * warhead checklist names the item that reads this.
 */
export function variantKeyWords(): string[] {
  return wordsForKeys(BINDINGS[VARIANT_ACTION].keys, []);
}

/* -------------------------------------------------------------------------- */
/* Reading a rectangle of the canvas                                          */
/* -------------------------------------------------------------------------- */

/** A rectangle of the field, in logical units. */
export interface Band {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The pixels the last frame left inside `band`, as `[r, g, b, a]` per pixel.
 *
 * Read off the real context in ONE call rather than a point at a time, so a check
 * comparing two paintings of a menu row reads thousands of pixels without
 * thousands of round trips. The rectangle is mapped through the engine's own
 * viewport and clipped to the canvas, so it is the same region of the FIELD
 * whatever letterboxing the surface produced.
 */
export function readBand(h: Harness, band: Band): Uint8ClampedArray {
  const from = h.device(band.left, band.top);
  const to = h.device(band.right, band.bottom);
  const x = Math.max(0, Math.min(from.x, to.x));
  const y = Math.max(0, Math.min(from.y, to.y));
  const width = Math.min(h.canvas.width - x, Math.abs(to.x - from.x));
  const height = Math.min(h.canvas.height - y, Math.abs(to.y - from.y));
  if (width < 1 || height < 1) {
    fail(
      "a menu row wide and tall enough to read back off the canvas " +
        "(specs/ui.md)",
      `${width} x ${height} device pixels`,
    );
  }
  return h.ctx.getImageData(x, y, width, height).data;
}

/**
 * How many pixels of a band changed colour by more than `delta`, of the `441` an
 * RGB distance can span.
 *
 * The two readings must be the same rectangle; a shorter one ends the comparison,
 * so nothing is compared against a pixel that was never read.
 */
export function changedPixels(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  delta: number,
): number {
  const pixels = Math.min(before.length, after.length) / 4;
  let changed = 0;
  for (let i = 0; i < pixels; i += 1) {
    const at = i * 4;
    const moved = colorDistance(
      { r: before[at], g: before[at + 1], b: before[at + 2] },
      { r: after[at], g: after[at + 1], b: after[at + 2] },
    );
    if (moved > delta) changed += 1;
  }
  return changed;
}
