// Deepcore — reading one drawn frame against another, for the screen checks.
// CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it.
//
// WHY THESE EXIST. specs/ui.md fixes what each screen must CARRY — its title, its
// menu entries, the subjects the how-to screen covers, the depths the size choice
// quotes — and deliberately fixes no copy beyond that and no layout at all: "The
// content and the navigation are fixed; the layout is yours." So a screen check
// reads the entries the specification names through the package's `drewText`, a
// substring ignoring case, reads a SUBJECT the specification fixes only the
// vocabulary of through {@link drawnCopy} and a word-boundaried expression, and
// reads everything else about the screen as a shape rather than as text.
//
// The one reading that is not about words is the highlight. specs/ui.md says only
// that "the highlighted item is drawn distinctly from the others", which cannot
// be read as a colour without fixing a palette. What it can be read as is a
// DIFFERENCE: the frame with one entry highlighted must draw differently from the
// frame with the next entry highlighted. A build that animates its menu draws two
// frames differently anyway, so the comparison is calibrated against a pair of
// frames taken at the SAME highlight: the change the highlight makes has to be
// bigger than the change a frame makes on its own.

import type { DrawCall, Harness } from "../harness";
import { drawnText, drawnTextLines } from "../case-harness/text";

/** One frame's operations, each flattened to a comparable string. */
export function signature(calls: readonly DrawCall[]): string[] {
  return calls.map((call) => JSON.stringify(call));
}

/**
 * How far apart two frames are: operations at the same position that differ,
 * plus whatever length they differ by.
 */
export function frameDistance(
  a: readonly DrawCall[],
  b: readonly DrawCall[],
): number {
  const left = signature(a);
  const right = signature(b);
  const shared = Math.min(left.length, right.length);
  let distance = Math.abs(left.length - right.length);
  for (let i = 0; i < shared; i += 1) {
    if (left[i] !== right[i]) distance += 1;
  }
  return distance;
}

/**
 * Every string of text the frame drew, upper-cased and joined, for a VOCABULARY
 * reading: the package's raw `fillText` split AND the logical runs it spells.
 *
 * THIS IS NOT A COPY READER. Copy the specification fixes the words of is read
 * through the package's `drewText`, and nothing here re-spells that. What the
 * package cannot answer is a subject the specification fixes only the TERMS of
 * — `screens/how-to-play-subjects` names several words for each, any of which
 * covers it, and a figure may carry a build's own thousands separator — which
 * is a regular expression over the frame's text, with word boundaries, and the
 * package's readers take a substring. So this hands the whole frame back as one
 * string for such an expression to run over, and folds nothing but case: no
 * whitespace comes out, because the boundaries depend on it.
 *
 * The runs (`drawnTextLines`) are there because a build that letter-spaces a
 * heading draws one glyph per call, and a word the copy readings look for has
 * to come back whole, not as glyphs with a separator between each. The raw
 * split (`drawnText`) is KEPT beside them because the copy readings anchor on
 * word boundaries that the separator supplies and a coalesced run can remove:
 * a build that draws "SMALL" and "1,200 m" as two calls placed by measurement,
 * with no space glyph between, spells the run "SMALL1,200 m", where `\b1200\b`
 * no longer matches. Read both and a word found by either reading matches, so
 * coalescing can only add a match here too.
 */
export function drawnCopy(calls: readonly DrawCall[]): string {
  return [...drawnText(calls), ...drawnTextLines(calls)]
    .join(" • ")
    .toUpperCase();
}

/**
 * Drive one frame at each of `indices` on the current menu screen and hand back
 * what each drew, with a second frame at the first index for calibration.
 */
export async function framesAtIndices(
  h: Harness,
  indices: readonly number[],
): Promise<{ frames: DrawCall[][]; still: DrawCall[] }> {
  const frames: DrawCall[][] = [];
  let still: DrawCall[] = [];
  for (const [at, index] of indices.entries()) {
    h.debug.setMenuIndex(index);
    frames.push(await h.frameCalls());
    if (at === 0) still = await h.frameCalls();
  }
  return { frames, still };
}
