// Fathom — reading a FIGURE out of the text a build drew. CASE-PROVIDED.
//
// Several points hold a number the snapshot reports against the text the frame
// put on the canvas: the score on the top strip, the depth the game-over screen
// reports, every figure the diagnostics overlay draws. What the specifications
// fix in each case is the FIGURE, never how it is written — specs/ui.md keeps
// the score and the depth in their strips and leaves the wording to the build,
// and specs/instrumentation.md has a source report the fact the snapshot
// reports and says nothing about its formatting. So a build is free to pad,
// group or label the figure, and `SCORE 04731`, `4731 PTS` and `4,731` all
// report the same score.
//
// GROUPING IS THE PART THAT NEEDS SAYING. Writing a figure with a separator
// between its digit triples is what `Number.prototype.toLocaleString()` does by
// default, and it is what a build drawing a score for a player to read is
// entitled to do — so a grouped figure reads here as the ONE figure it is. The
// separators accepted are the ones a build actually renders a figure with: the
// comma, the apostrophe Swiss usage takes, and the three fixed-width spaces
// `U+00A0` (no-break), `U+202F` (narrow no-break) and `U+2009` (thin).
//
// TWO CHARACTERS ARE DELIBERATELY NOT SEPARATORS, and both omissions are load
// bearing:
//
//   THE ASCII SPACE. A frame's text is read by joining its separate draw runs,
//   so a build that draws `40` in one run and `130` in another has drawn two
//   figures. Accepting a plain space would read those as the single figure
//   `40130` and pass a screen that never carried it.
//
//   THE FULL STOP. It is the decimal point: a build drawing `1.5` means one
//   and a half, and reading the stop as a separator would make that fifteen.
//
// AND NOTHING ELSE IS LOOSENED. The bounded reading below still asks for a
// figure of its own, with a digit boundary on each side, so a screen showing
// `150` is not read as showing `50`.

/** The characters a build may put between a figure's digit triples. */
const SEPARATORS = [",", "'", "\u00A0", "\u202F", "\u2009"] as const;

/** `text` as a pattern that matches exactly itself. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `digits` with `separator` between each triple, counted from the right. */
function grouped(digits: string, separator: string): string {
  let out = "";
  for (let at = digits.length; at > 0; at -= 3) {
    const head = Math.max(0, at - 3);
    out = digits.slice(head, at) + (out === "" ? "" : separator + out);
  }
  return out;
}

/**
 * Every conventional writing of `value`: the plain one first, then one per
 * separator a build may group its digit triples with.
 *
 * A figure of three digits or fewer has nothing to group, so it has exactly one
 * writing. A sign and a fractional part are carried through untouched — only
 * the whole part is ever grouped — and a value JavaScript writes in some other
 * form altogether, an exponent or a `NaN`, is left as the one string it gave.
 */
function figureRenderings(value: number): string[] {
  const plain = String(value);
  const sign = plain.startsWith("-") ? "-" : "";
  const body = sign === "" ? plain : plain.slice(1);
  const point = body.indexOf(".");
  const whole = point < 0 ? body : body.slice(0, point);
  const fraction = point < 0 ? "" : body.slice(point);
  if (whole.length <= 3 || !/^\d+$/.test(whole)) return [plain];
  return [
    plain,
    ...SEPARATORS.map((one) => sign + grouped(whole, one) + fraction),
  ];
}

/** Every writing of `value`, as one alternation. */
function alternation(value: number): string {
  return `(?:${figureRenderings(value).map(escapeRegExp).join("|")})`;
}

/**
 * `value` written as a figure OF ITS OWN, however the build grouped it.
 *
 * A digit boundary on both sides, and the decimal point counts as a digit for
 * that boundary: `50` is not found inside `150`, and `1` is not found inside
 * `1.5`.
 */
export function figurePattern(value: number): RegExp {
  return new RegExp(`(?<![\\d.])${alternation(value)}(?![\\d.])`);
}

/**
 * `value` written ANYWHERE inside a run of text, however the build grouped it.
 *
 * No boundary, because the readers that reach for this are the ones
 * specs/ui.md lets a build pad and label at will: a score drawn as
 * `SCORE 04731` carries the figure `4731` and is read as carrying it.
 */
export function figureAnywherePattern(value: number): RegExp {
  return new RegExp(alternation(value));
}
