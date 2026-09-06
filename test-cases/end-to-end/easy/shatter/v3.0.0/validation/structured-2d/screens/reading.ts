// Shatter — how the `screens/*` points READ a screen: where a menu's entries
// were drawn, whether a row's drawing changed between two frames, whether a
// number reached the canvas at all, and whether a key was named as a standalone
// word. Whether a PHRASE of copy was drawn — the title, a menu entry — is the
// shared harness's own `drewText` (`case-harness/text.ts`), which the points
// that want it import directly; nothing here re-reads it.
//
// `specs/ui.md` leaves "the palette, the type, and the layout of each screen" to
// the build and fixes only the COPY and the ORDER. So every reading here is
// about placement and presence, never about a colour, a font or a coordinate:
// what the four points that use it assert is that the words are there, that the
// first entry is above the second, that the highlight moves, and that the score
// and the wave are on the game-over screen.
//
// NOTHING HERE IS A THRESHOLD. Every bound the points assert — how far apart two
// colours must be to have changed, how many pixels of change is a highlight
// rather than a stray anti-aliased edge — is stated in the point that asserts
// it, derived from a figure or a rule `specs/ui.md` states. What lives here is
// the reading those points share.

import { fail } from "../assert";
import { colorDistance, spelledTextRuns, type Harness } from "../harness";

/** Where one menu entry was drawn, in the field's own logical units. */
export interface MenuRow {
  /** The entry, exactly as `specs/ui.md` spells it. */
  item: string;
  /** The vertical placement of the entry's drawn glyphs. */
  y: number;
  /** The leftmost and rightmost logical x the entry's glyphs reached. */
  left: number;
  right: number;
}

/**
 * Which of `items` a run of drawn text is showing, or `undefined` for a run that
 * shows none of them.
 *
 * THE LONGEST ENTRY THE RUN CONTAINS WINS, and the title menu is why. Its two
 * entries are `PLAY` and `HOW TO PLAY` (`specs/ui.md`), and the second contains
 * the first — so a run reading `HOW TO PLAY` contains BOTH, and matching on the
 * first hit would file the second entry under the first and report the menu as
 * two copies of one entry. Taking the longest containment files each run under
 * the entry it is actually showing, whatever decoration the build drew around
 * it.
 *
 * Matching is by containment and ignores case, because how an entry is
 * PRESENTED is the build's: `specs/ui.md` fixes the words and leaves the look
 * alone, and a menu is commonly drawn with a marker or padding beside the
 * highlighted entry.
 */
function itemShownBy(
  text: string,
  items: readonly string[],
): string | undefined {
  const run = text.toLowerCase();
  let found: string | undefined;
  for (const item of items) {
    if (!run.includes(item.toLowerCase())) continue;
    if (found === undefined || item.length > found.length) found = item;
  }
  return found;
}

/**
 * Where each of `items` was drawn on the frame currently recorded in `h.calls`,
 * in the order `items` gives them.
 *
 * A build may draw an entry more than once — a shadow behind the glyphs, an
 * outline over them — so every run filed under an entry contributes: the row's
 * `y` is the mean of their anchors and its extent is their union.
 *
 * THE RUNS ARE THE LOGICAL ONES, not the `fillText` calls. A build that
 * letter-spaces its menu draws one glyph per call — the only portable way to
 * letter-space canvas text — and `specs/ui.md` fixes the words while leaving
 * their spacing to the build, so a call-by-call reading would find `P`, `L`,
 * `A`, `Y` and no entry. `harness.ts`'s `spelledTextRuns` coalesces the glyphs
 * back into the string they spell, placed as one extent, which is exactly the
 * row a highlight check wants to band. Matching by containment, coalescing can
 * only add a match: every raw string is a substring of its run.
 *
 * An entry no run showed is a FAILURE here rather than a gap in the answer,
 * naming the entry the specification fixes and the runs the frame actually
 * drew. The points that call this go on to compare rows, and a missing row has
 * no comparison to be part of.
 */
export function menuRows(h: Harness, items: readonly string[]): MenuRow[] {
  const spans = spelledTextRuns(h);
  return items.map((item) => {
    const mine = spans.filter((span) => itemShownBy(span.text, items) === item);
    if (mine.length === 0) {
      fail(
        `a run of drawn text showing the menu entry ${JSON.stringify(item)} ` +
          `(specs/ui.md), among the ${String(items.length)} the screen's menu ` +
          `shows`,
        spans.map((span) => span.text),
      );
    }
    return {
      item,
      y: mine.reduce((sum, span) => sum + span.y, 0) / mine.length,
      left: Math.min(...mine.map((span) => span.left)),
      right: Math.max(...mine.map((span) => span.right)),
    };
  });
}

/**
 * How many pixels of one full-width horizontal band changed between two
 * captures of the canvas, by more than `distance` of the 441 an RGB difference
 * runs to.
 *
 * The band is the whole width of the field at `y`, `halfHeight` units either
 * side of it, because WHERE a build marks its highlighted entry is the build's:
 * a marker glyph beside the words, an underline beneath them, a plate behind
 * them and a recolouring of the words themselves are all the same requirement
 * met, and only a reading that takes in the entry's whole row sees all four.
 *
 * The two captures must be of the same scene apart from the one thing under
 * test — the point that calls this takes them from the same seeded `reset` — so
 * a pixel that differs at all differs because of that one thing.
 */
export function bandChanged(
  h: Harness,
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  y: number,
  halfHeight: number,
  distance: number,
): number {
  const width = h.canvas.width;
  const top = Math.max(0, h.device(0, y - halfHeight).y);
  const bottom = Math.min(h.canvas.height, h.device(0, y + halfHeight).y);

  let changed = 0;
  for (let row = top; row < bottom; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const i = (row * width + column) * 4;
      const was = { r: before[i], g: before[i + 1], b: before[i + 2] };
      const now = { r: after[i], g: after[i + 1], b: after[i + 2] };
      if (colorDistance(was, now) > distance) changed += 1;
    }
  }
  return changed;
}

/**
 * Every run of text the frame spelled, and — after them — every call of a run
 * that was drawn in more than one call.
 *
 * THE RUNS, NOT THE CALLS. A build that letter-spaces its title or its how-to
 * copy draws one glyph per `fillText`, which is the only portable way to
 * letter-space canvas text, and `specs/ui.md` fixes the words while leaving
 * their spacing to the build; read a call at a time, such a screen shows `S`,
 * `H`, `A`… and never the title. `harness.ts`'s `spelledTextRuns` coalesces the
 * glyphs back into the string they spell.
 *
 * AND THE CALLS BEHIND THEM. Coalescing can only add a match by containment,
 * but the how-to check wants each key as a standalone word, and the merge can
 * glue two runs the build set a bare space apart, in two calls, into one. So a
 * run drawn in several calls is followed by those calls, and a word found in
 * either is found. A run drawn whole is not repeated.
 */
function spelledRuns(h: Harness): string[] {
  const runs = spelledTextRuns(h);
  return [
    ...runs.map((run) => run.text),
    ...runs
      .filter((run) => run.parts.length > 1)
      .flatMap((run) => run.parts.map((part) => part.text)),
  ];
}

/**
 * Every run of text the frame spelled, lower-cased and joined by ` | `.
 *
 * The container a standalone-WORD check runs against, and the value a figure
 * check's failure prints — so a build that drew the wrong copy is reported as
 * the copy it DID draw rather than as the word `false`. The separator is one no
 * piece of screen copy carries, so a match can never straddle two runs, and the
 * case is dropped because `specs/ui.md` fixes the words a screen shows and
 * leaves how they are set to the build. The runs are {@link spelledRuns}: the
 * logical runs, with the calls of any run drawn a call at a time laid out after
 * them.
 */
export function drawnRuns(h: Harness): string {
  return spelledRuns(h).join(" | ").toLowerCase();
}

/**
 * Whether some run of text the frame spelled carries `digits` as a run of
 * digits.
 *
 * Every non-digit is dropped from each run before the comparison, so the reading
 * is the NUMBER a run showed rather than the way it was written.
 * `specs/ui.md` requires the game-over screen to show "the final score and the
 * wave the game reached" and fixes nothing about the presentation, so a build
 * that labels its figure (`SCORE 47320`), groups it (`47,320`), or does both
 * has shown the number the specification asked for and a check that demanded
 * the bare run would fail it for its formatting. And one that letter-spaces
 * its figure, a digit per call, has too — the runs are {@link spelledRuns}.
 */
export function drewDigits(h: Harness, digits: string): boolean {
  return spelledRuns(h).some((run) => run.replace(/\D/g, "").includes(digits));
}
