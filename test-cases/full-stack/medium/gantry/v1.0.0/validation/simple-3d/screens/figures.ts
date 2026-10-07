// screens/figures — the one reader these suites read a FIGURE off the screen
// with: how many, rather than which words.
//
// Copy itself is read with the harness's own `drewText`/`drewTextAnywhere`
// (`case-harness/text.ts`), and the run a piece of copy starts in with
// `./reading`. What a readout ALSO shows is a number — a cost, a budget, a par
// figure, a step count, an axis value — and every specification here fixes the
// FIGURE while leaving to the build how the figure is written. `2400`,
// `2,400`, `2 400` and `PAR 2400` are one readout as far as any of these points
// is concerned, so a screen is read for the numbers in it, with whatever a
// build set between a figure's digit triples taken out first.
//
// THE ONE AMBIGUITY IS THE ASCII SPACE, and it has two sources that mean
// opposite things.
//
//   - A space the BUILD wrote, inside one `fillText`, is the build's own
//     typesetting. A single call drawing `2 400` draws the figure 2400 grouped
//     for reading — which is exactly what this case's own reference does, its
//     `cost` formatter grouping with a space (`src/render-format.ts`) — and
//     reading that as the two figures 2 and 400 loses the readout entirely.
//   - A space the MERGE wrote, between two draws, is not in the frame at all.
//     `drawnTextRuns` coalesces side-by-side draws into the logical run they
//     spell and writes a space of its own wherever it detects a word gap
//     (`case-harness/text.ts`), so a screen drawing `40` and `130` a gap apart
//     spells `40 130` in the run — and grouping across THAT would invent the
//     figure 40130, which nothing on the screen says.
//
// SO THE TWO ARE ASKED SEPARATELY AND EVERY ANSWER IS TAKEN.
//
//   - Each RAW draw is read with the ASCII space allowed to group, because the
//     build passed that whole string to one text call and every space in it is
//     the build's own.
//   - The coalesced RUN is read with the ASCII space NOT allowed to group,
//     because a space there may be the merge's. A figure a build letter-spaced
//     a glyph per call is whole only in the run, and letter-spacing is the only
//     portable way to track canvas text, so this reading is what keeps such a
//     build legible.
//
// Neither reading alone will do: the raw draws lose the letter-spaced figure,
// and the runs lose the grouped one. Their union adds a reading and never takes
// one away, so every build whose figures read before reads the same way still.
//
// WHAT THE UNION COSTS, stated plainly: a build that draws two figures a space
// apart INSIDE ONE CALL — `40 130` from a single `fillText` — is read as 40 and
// 130 and ALSO as 40130, because nothing in the frame tells that apart from a
// grouped figure. These points all ask whether a figure IS on the screen, so
// the cost is a reading a check may credit rather than a readout a check may
// miss; the only alternative is to refuse every space-grouped figure, which is
// a readout the screen plainly shows and the reference plainly draws.
//
// A FIGURE IS BOUNDED BY NON-DIGITS. `1,2345` is not a grouped figure — a
// triple that runs on into a fourth digit is a build writing something else —
// so the grouped reading is refused there and the plain one stands.

import {
  drawnTextRuns,
  RUN_BACKTRACK_SLACK,
  RUN_BASELINE_SLACK,
  textDraws,
  type DrawCall,
  type TextDraw,
} from "../case-harness/index";

/**
 * A piece of drawn copy, in the two forms a figure is read off.
 *
 * The two are one frame read twice over rather than two readings to choose
 * between, for the reason in this module's header: the space inside a part is
 * the build's and may group a figure, and a space in the text may be the
 * merge's and may not.
 */
export interface DrawnCopy {
  /** What the copy reads as: the logical run, the merge's spaces and all. */
  readonly text: string;
  /** The strings the build itself passed to one text call, in reading order. */
  readonly parts: readonly string[];
}

/** One logical run of text, placed as `drawnTextRuns` places it. */
export interface FigureRun extends TextDraw {
  /** The raw draws that spelled this run, left to right. */
  readonly parts: readonly string[];
}

/**
 * The separators a build may set between a figure's digit triples, WITHOUT the
 * ASCII space — the reading a coalesced run gets, where a space may be one the
 * merge wrote between two draws rather than anything the frame shows.
 *
 * `.` is absent from both classes for a different reason: it is the decimal
 * point, and a build drawing `1.5` means one and a half.
 */
const MERGED_GROUP = "[,'\\u00A0\\u202F\\u2009]";

/**
 * The same separators WITH the ASCII space — the reading one raw draw gets,
 * where every character came out of the build's own string.
 */
const DRAWN_GROUP = "[,'\\u00A0\\u202F\\u2009 ]";

/**
 * A minus sign that OPENS a figure rather than joining two of them.
 *
 * A sign is read only where the character before it is neither a word character
 * nor a decimal point, so `TARGET -0.5` reads minus a half while `BUDGET-5600`
 * and `340-5600` read the positive figures a build set a rule or a range
 * between. A figure with no sign is read wherever it does not continue one:
 * that is what keeps `COST981` legible while refusing to find 234 inside 1234.
 */
const SIGN = "(?:(?<![\\w.])-)?";

/** One drawn number under `group`: a grouped figure, or a plain one. */
function drawnPattern(group: string): RegExp {
  return new RegExp(
    `(?<![\\d.])${SIGN}(?:\\d{1,3}(?:${group}\\d{3})+(?!\\d)|\\d+)(?:\\.\\d+)?`,
    "g",
  );
}

/**
 * One GROUPED figure under `group`, and only a grouped one.
 *
 * THE RAW READING HAS NO PLAIN ALTERNATIVE, AND THAT IS THE WHOLE OF WHAT KEEPS
 * IT HONEST. A plain number inside a draw is already a plain number inside the
 * run that draw belongs to, so admitting it a second time adds nothing true —
 * and it adds something false. A build that letter-spaces its readouts draws a
 * glyph per call, which is the only portable way to letter-space canvas text, so
 * the value `3.0` arrives as the draws `"3"`, `"."`, `"0"`, `"u"`; read plainly,
 * each is its own figure and the frame is credited with a `0` the build never
 * drew. `screens/run-readout-no-target-without-a-live-command` reads exactly
 * that: a line carrying any figure besides its axis's own value is a build
 * drawing a target it should not, so a stray `0` off a letter-spaced `3.0`
 * fails a build for its typesetting.
 *
 * Restricted to the grouped form, the raw reading can only ever ADD the figure
 * an ASCII space groups — the one thing the merged reading cannot see — and a
 * lone glyph, having no separator in it, matches nothing at all.
 */
function groupedPattern(group: string): RegExp {
  return new RegExp(
    `(?<![\\d.])${SIGN}\\d{1,3}(?:${group}\\d{3})+(?!\\d)(?:\\.\\d+)?`,
    "g",
  );
}

/** Every number `text` carries under `pattern`, with `group` taken back out. */
function read(text: string, group: string, pattern: RegExp): number[] {
  return (text.match(pattern) ?? []).map((one) =>
    Number(one.replace(new RegExp(group, "g"), "")),
  );
}

/**
 * Every figure a piece of drawn copy carries, as figures rather than
 * characters.
 *
 * The union of the two readings this module's header sets out, in the order
 * they were read and with a figure both readings found given once: a grouped
 * figure reads as the one figure it is, so `2,350`, `2 350` and `2350` all come
 * back as 2350 and a build is free to set the figure however it likes.
 */
export function figuresIn(copy: DrawnCopy): number[] {
  return [
    ...new Set([
      ...read(copy.text, MERGED_GROUP, drawnPattern(MERGED_GROUP)),
      ...copy.parts.flatMap((part) =>
        read(part, DRAWN_GROUP, groupedPattern(DRAWN_GROUP)),
      ),
    ]),
  ];
}

/**
 * Whether `draw` is one of the draws `run` was coalesced out of.
 *
 * `drawnTextRuns` is a PARTITION of the same draws `textDraws` answers, and it
 * builds a run's extent out of its members: every member sits on the run's
 * baseline within {@link RUN_BASELINE_SLACK} and inside its extent to within
 * the {@link RUN_BACKTRACK_SLACK} the merge itself allows a draw to sit back
 * by. Recovering the membership geometrically rather than re-deriving the merge
 * is what keeps ONE merge rule in the package: the two slacks are exported for
 * exactly this, and the two runs a draw could fall in are neighbours on one
 * baseline whose extents overlap by less than half a pixel, so the worst a
 * mis-attribution can do is read a figure the screen does draw against the run
 * beside the one that drew it.
 */
function spelled(run: TextDraw, draw: TextDraw): boolean {
  return (
    Math.abs(draw.y - run.y) <= RUN_BASELINE_SLACK &&
    draw.left >= run.left - RUN_BACKTRACK_SLACK &&
    draw.right <= run.right + RUN_BACKTRACK_SLACK
  );
}

/**
 * Every logical run of text the frame spelled, each carrying the raw draws that
 * spelled it, so {@link figuresIn} can read a run both ways.
 *
 * The runs are `drawnTextRuns`' own, in its reading order and at its placement,
 * so this stands in for that call wherever a suite also wants the run's
 * figures — and a suite that wants nothing but the copy still calls that
 * directly.
 */
export function figureRuns(calls: readonly DrawCall[]): FigureRun[] {
  const drawn = textDraws(calls).filter((draw) => draw.text.length > 0);
  return drawnTextRuns(calls).map((run) => ({
    ...run,
    parts: drawn
      .filter((draw) => spelled(run, draw))
      .sort((one, two) => one.left - two.left)
      .map((draw) => draw.text),
  }));
}

/**
 * Every figure a set of runs carries between them — a line's worth, a row's
 * worth, or a whole frame's.
 *
 * No figure is read ACROSS two runs, which is the same answer joining the runs
 * into one line and reading that gives: the merged reading refuses to group
 * over the space such a join writes, and the drawn reading never sees the join
 * at all.
 */
export function figuresAcross(runs: readonly FigureRun[]): number[] {
  return [...new Set(runs.flatMap((run) => figuresIn(run)))];
}
