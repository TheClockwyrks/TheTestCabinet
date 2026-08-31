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
import { BINDINGS, ACTIONS } from "../../src/constants";
import { colorDistance, type DrawCall, type Harness } from "../harness";

/* -------------------------------------------------------------------------- */
/* Text, and where it landed                                                  */
/* -------------------------------------------------------------------------- */

/** One run of text the frame drew, placed in the logical `1280 x 720` field. */
export interface TextRun {
  /** The string as the build passed it. */
  readonly raw: string;
  /** The same string upper-cased with its runs of whitespace collapsed. */
  readonly text: string;
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
 * Every run of text in the recorded calls, placed in logical field units.
 *
 * The placement is the real one. `fillText` is called in the build's own user
 * space, so the harness records the context transform at the moment of the call
 * along with the measured width and the alignment; the anchor is pushed through
 * that transform into device pixels, and the engine's viewport — the letterbox
 * offset and the device-pixels-per-logical-unit scale it chose — takes it the rest
 * of the way back into the field's own units. A build that drew its menu inside a
 * `translate`/`scale` of its own is read exactly like one that did not.
 *
 * A caller reads ONE frame by clearing the call list before the advance that drew
 * it; this does no clearing of its own.
 */
export function textRuns(h: Harness, calls: readonly DrawCall[]): TextRun[] {
  const view = h.engine.viewport();
  const runs: TextRun[] = [];

  for (const call of calls) {
    if (call.kind !== "call") continue;
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const raw = call.args[0];
    const ax = call.args[1];
    const ay = call.args[2];
    const placed = call.text;
    if (typeof raw !== "string") continue;
    if (typeof ax !== "number" || typeof ay !== "number") continue;
    if (placed === undefined) continue;

    const m = placed.transform;
    const deviceX = m.a * ax + m.c * ay + m.e;
    const deviceY = m.b * ax + m.d * ay + m.f;
    const x = (deviceX - view.offsetX) / view.scale;
    const y = (deviceY - view.offsetY) / view.scale;

    // The measured width is in the build's user space; the same transform's own
    // horizontal scale carries it to device pixels and the viewport's to logical.
    const width = (placed.width * Math.hypot(m.a, m.b)) / view.scale;
    const align = placed.textAlign;
    const left =
      align === "center"
        ? x - width / 2
        : align === "right" || align === "end"
          ? x - width
          : x;

    runs.push({ raw, text: normalize(raw), x, y, left, right: left + width });
  }
  return runs;
}

/** Where one run ends and the next begins in {@link drawnCopy}. */
const BETWEEN_RUNS = " | ";

/**
 * Every run the frame drew, laid end to end as one string a failure can print.
 *
 * This is the `Actual:` line of every copy check in this group: a build that drew
 * the wrong words shows the reviewer the words it did draw, beside the copy
 * `specs/ui.md` fixes. Each run is {@link normalize}d and the runs are separated
 * by a marker that appears in no piece of screen copy, so nothing matches across
 * the join.
 *
 * Group separators are dropped from BETWEEN DIGITS, and only there, so a score
 * drawn as `4,260` reads as the number it is while `WAVE 13` is left alone.
 */
export function drawnCopy(runs: readonly TextRun[]): string {
  return runs
    .map((run) => run.text)
    .join(BETWEEN_RUNS)
    .replace(/(?<=\d)[ ,'_](?=\d)/g, "");
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
 * `value` as a WHOLE number — a run of digits reading `value` with no further
 * digit either side of it.
 *
 * `specs/ui.md` shows the score "as digits" and leaves everything else about the
 * readout to the build, so a label beside it (`SCORE 4260`) reads as the number
 * and the `13` inside `1300` does not.
 */
export function numberPattern(value: number): RegExp {
  return new RegExp(`(?<!\\d)${String(value)}(?!\\d)`);
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

/**
 * Every word the how-to screen must name, derived from the keys the game BINDS.
 *
 * Read off `BINDINGS` rather than written out, so the list is the one
 * `specs/controls.md` states for the variant actually being graded: `base` binds
 * seven words and `warhead` adds `F` for the torpedo, and the same check decides
 * both without knowing which it is running against.
 */
export function boundKeyWords(): string[] {
  const words: string[] = [];
  for (const action of ACTIONS) {
    for (const key of BINDINGS[action].keys) {
      const word = WORD_FOR_KEY[key];
      if (word === undefined) {
        fail(
          `a key specs/controls.md names a standalone word for, one of ` +
            `${Object.keys(WORD_FOR_KEY).join(", ")}`,
          key,
        );
      }
      if (!words.includes(word)) words.push(word);
    }
  }
  return words;
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
