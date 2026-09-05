// presentation/overlay — reading the debug overlay's lines off two frames.
//
// Only the five overlay points read a frame this way, so this lives beside them
// rather than in the shared harness next door, and like everything there it
// fixes a READING alone and never a threshold.
//
// WHOSE OVERLAY IT IS. Under this engine there is no engine: `specs/controls.md`
// says the panel and its `Backquote` toggle "are part of the runtime layer you
// write", and `specs/instrumentation.md` says the same — "It draws the
// registered values, it is shown and hidden by the key `specs/controls.md`
// names, it is off when the game starts, and it reads the game without changing
// it." So the build owns the panel as well as the sources. What the five points
// beside this file decide is still only the SOURCES — which values the game
// registers, and that registering them changes nothing — because that is the one
// part of the overlay every engine's build owns, and the case grades one
// requirement the same way on all three.
//
// HOW THE LINES ARE FOUND. The panel is drawn over the finished frame through
// the same 2D context every other rendering point reads, so the text a steady
// frame draws WITHOUT the panel is collected first and the text a frame draws
// WITH it second; what the second drew and the first did not is the panel's own
// lines. A multiset difference rather than a set one, so a build that draws the
// same string twice keeps both copies and a panel line that merely repeats
// something the table already draws is not silently swallowed.
//
// HOW A VALUE IS RECOGNISED. A panel line is a NAME and a VALUE, and the name is
// the build's own word — `specs/instrumentation.md` lists what to register and
// fixes no spelling, no layout and no punctuation. Where a build separates the
// two with `": "` the reading takes the value half alone, so a build whose flag
// is NAMED `dragging` is not read as reporting a live drag while its value says
// `none`; where it separates them any other way the line is read whole, which
// can only make a point more permissive and never wrongly strict. A number is
// then matched as a whole figure, never as a substring, so a `4` is not answered
// by the `4` inside `14`, and a figure whose digits the build grouped into
// triples — `1,234` — is the one number it draws.
//
// WHAT THIS READING CANNOT DO, AND WHY THE POINTS ARE POSED THE WAY THEY ARE. A
// build is free to draw lines of its own beside the ones the specification asks
// for — a frame counter, a delta, a seed — and a stray figure among them could
// stand in for a source that was never registered. Nothing can tell one from the
// other from outside, so each point instead poses a board on which the figures
// it asserts are as distinctive as the game allows, and asserts a figure as many
// times as the board owes it.

import { fail } from "../assert";
import { drawnText, type DrawCall } from "../harness";

/**
 * The lines the panel added: what the toggled frame drew that the steady frame
 * before it did not.
 */
export function overlayLines(
  before: readonly DrawCall[],
  after: readonly DrawCall[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of drawnText(before)) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return drawnText(after).filter((line) => {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      return false;
    }
    return true;
  });
}

/**
 * The value half of each line: what a source reported, without the name the
 * build reported it under, where the two are separated by `": "`.
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
 * is drawn to the build, so a count drawn through
 * `Number.prototype.toLocaleString()` as `1,234` and the same count drawn as
 * `1234` are the same report and read as the one number. The apostrophe and the
 * three narrow spaces are here for the same reason: they are what a locale group
 * separator is, and which one a build's formatting reaches for is not what any
 * point beside this file decides.
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
 * `times` is how many figures must read as that value: a board on which two
 * piles hold the same number of cards owes a figure for each of them, and a
 * panel reporting one of the two has not reported the other.
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
        : `${String(times)} overlay figures reading ${what} ` +
            `(${String(value)}), and ${String(carried)} did`,
      lines,
    );
  }
}

/**
 * Some line REPORTS a value matching `pattern`, and fails naming what was
 * wanted.
 *
 * The pattern is held against the value alone where a build separated it from
 * its name, so a source whose name happens to read like the answer does not
 * stand in for the answer. The whole lines are what the failure shows, because
 * that is what a reviewer needs to see.
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
