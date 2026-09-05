// presentation/overlay — reading the debug overlay's lines off two frames.
//
// Only the five overlay points read a frame this way, so this lives beside them
// rather than in the shared harness next door, and like everything there it fixes
// a READING alone and never a threshold.
//
// WHOSE OVERLAY IT IS. Under this engine the panel, the `Backquote` key that
// toggles it, its default-off state and the formatting of every line are the
// ENGINE's (specs/instrumentation.md, and the engine's own `diagnostics.md`).
// What the BUILD owns is which diagnostic sources it registers, through
// `InitApi.diagnostics`, so that is the whole of what these points decide.
//
// HOW THE LINES ARE FOUND. The engine draws the overlay after the game's
// `render`, through the same context the harness records, so the text a steady
// frame draws WITHOUT the panel is collected first and the text the toggle's
// frame draws WITH it second; what the second drew and the first did not is the
// panel's own lines. The engine's frame-time line is dropped from that
// difference: it is the engine's, not one of the game's sources, and its figures
// are wall-clock timings that vary from run to run.
//
// HOW A VALUE IS RECOGNISED. The engine draws each line as `${name}: ${value}`
// (engine docs, `diagnostics.md`), and the NAME is the build's own word —
// specs/instrumentation.md lists what to register and fixes no spelling — so
// every reading here is taken from the VALUE half of the line and never from the
// whole of it. That matters in both directions: a build whose sources are named
// `col0`…`col6` must not have the digits in its own names counted as counts, and
// a build whose flag is named `dragging` must not be read as reporting a live
// drag while its value says `false`. A number is then matched as a whole figure,
// never as a substring, so a `4` is not answered by the `4` inside `14`, and a
// figure whose digits the build grouped into triples — `1,234` — is the one
// number it draws; and where a value could be reported with the same figure by
// two sources, the point that reads it poses a board on which each figure it
// asserts is carried by the source it belongs to and by no other.

import { fail } from "../assert";
import { drawnText, type DrawCall } from "../harness";

/**
 * The engine's own frame-time line, which is not one of the game's sources.
 *
 * The engine draws it as `` `frame: ${meanMs} / ${p95Ms} / ${p99Ms} ms` ``
 * (engine docs, `diagnostics.md`), so it is recognised by the name it is drawn
 * under, and its wall-clock figures never reach a reading below.
 */
const ENGINE_METRICS = /^\s*frame\s*:/i;

/**
 * The lines the panel added: what the toggled frame drew that the steady frame
 * before it did not, less the engine's own metrics line.
 *
 * A multiset difference rather than a set one, so a build that draws the same
 * string twice keeps both copies and a line that merely repeats something the
 * game already drew on the table is not silently swallowed.
 */
export function overlayLines(
  before: readonly DrawCall[],
  after: readonly DrawCall[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of drawnText(before)) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return drawnText(after)
    .filter((line) => {
      const held = counts.get(line) ?? 0;
      if (held > 0) {
        counts.set(line, held - 1);
        return false;
      }
      return true;
    })
    .filter((line) => !ENGINE_METRICS.test(line));
}

/**
 * The value half of each line: what a source reported, without the name the
 * build reported it under.
 *
 * The engine draws a line as `${name}: ${value}` (engine docs,
 * `diagnostics.md`), so the value begins after the first `": "`. A line drawn in
 * some other shape is read whole, which is the safe reading: it can only make a
 * check more permissive, never wrongly strict.
 */
export function overlayValues(lines: readonly string[]): string[] {
  return lines.map((line) => {
    const at = line.indexOf(": ");
    return at < 0 ? line : line.slice(at + 2);
  });
}

/**
 * The separators a build may group a figure's digit triples with.
 *
 * specs/instrumentation.md fixes the FIGURE a source reports and leaves how it
 * is drawn to the build, so a count registered as `1234` and drawn through
 * `Number.prototype.toLocaleString()` as `1,234` is the same report and reads as
 * the one number. The apostrophe and the three narrow spaces are here for the
 * same reason: they are what a locale group separator is, and which one a
 * build's formatting reaches for is not what any point beside this file decides.
 *
 * The ASCII space is deliberately absent. A frame's text is a list of separate
 * draw runs joined with one, so accepting it would read the two figures in
 * `40 130` as the single number 40130. The `.` is deliberately absent too: it is
 * the decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** Those separators on their own, for stripping them back out of a match. */
const GROUPS = new RegExp(GROUP, "g");

/**
 * One figure as a build may draw it: digits grouped into triples, or a plain
 * run of them, either way with an optional sign and an optional fraction.
 *
 * The grouped form is tried first so that a grouped figure is taken whole rather
 * than as its leading triple, and both forms are anchored on nothing but their
 * own digits, so a figure is still read as a WHOLE run and never as a substring
 * of a longer one.
 */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every figure the values carry, in the order they were drawn. */
export function drawnNumbers(lines: readonly string[]): number[] {
  return overlayValues(lines).flatMap((value) =>
    (value.match(DRAWN) ?? []).map((drawn) =>
      Number(drawn.replace(GROUPS, "")),
    ),
  );
}

/**
 * Some line carries `value` as a whole figure, and fails naming what was wanted.
 *
 * `times` is how many lines must carry it: a board on which two piles hold the
 * same number of cards owes a figure for each of them, and a panel reporting one
 * of the two has not reported the other.
 */
export function assertFigure(
  lines: readonly string[],
  value: number,
  what: string,
  times = 1,
): void {
  const carried = drawnNumbers(lines).filter((drawn) => drawn === value).length;
  if (carried < times) {
    fail(
      times === 1
        ? `an overlay line carrying ${what} (${String(value)})`
        : `${String(times)} overlay lines carrying ${what} (${String(value)}), ` +
            `and ${String(carried)} carried it`,
      lines,
    );
  }
}

/**
 * Some line REPORTS a value matching `pattern`, and fails naming what was wanted.
 *
 * The pattern is held against the value alone, so a source whose name happens to
 * read like the answer does not stand in for the answer. The whole lines are what
 * the failure shows, because that is what a reviewer needs to see.
 */
export function assertForm(
  lines: readonly string[],
  pattern: RegExp,
  what: string,
): void {
  if (!overlayValues(lines).some((value) => pattern.test(value))) {
    fail(`an overlay line carrying ${what}`, lines);
  }
}
