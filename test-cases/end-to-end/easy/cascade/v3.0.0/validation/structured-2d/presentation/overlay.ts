// presentation/overlay — reading the debug overlay's lines off two frames.
//
// Only the five overlay points read a frame this way, so this lives beside them
// rather than in the shared harness next door, and like everything there it
// fixes a READING alone and never a threshold.
//
// WHOSE OVERLAY IT IS. Under this engine the panel, the `Backquote` key that
// toggles it, its default-off state and the formatting of every line are the
// ENGINE's (specs/instrumentation.md, and the engine's own `diagnostics.md`).
// What the BUILD owns is which diagnostic sources it registers, through
// `world.diagnostics` in the game mode's `beginPlay`, so that is the whole of
// what these points decide.
//
// HOW THE LINES ARE FOUND. The engine draws the overlay after the pipeline
// renders, through the same context the harness records, so the text a steady
// frame draws WITHOUT the panel is collected first and the text the toggle's
// frame draws WITH it second; what the second drew and the first did not is the
// panel's own lines. Two of those lines are the ENGINE's rather than the game's
// and are dropped from that difference: the world line it writes for every game,
// and the frame-time line, whose figures are wall-clock timings that vary from
// run to run.
//
// HOW A VALUE IS RECOGNISED. A line is `${name}: ${value}`, and the NAME is the
// build's own word — specs/instrumentation.md lists what to register and fixes
// no spelling — so every reading here is of the VALUE. A number is matched as a
// whole run of digits, never as a substring, so a `4` is not answered by the `4`
// inside `14`; and where a value could be reported with the same figure by two
// sources, the point that reads it poses a board on which each figure it asserts
// is carried by the source it belongs to and by no other.

import { fail } from "../assert";
import { drawnText, type DrawCall } from "../harness";

/**
 * The engine's own world line, which no game registers.
 *
 * The engine draws it as
 * `` `level: ${level}  phase: ${phase}  actors: ${count}` `` (engine docs,
 * `diagnostics.md`), so it is recognised by the name it is drawn under. Dropping
 * it matters: its `phase` is the game mode's, and a point that read the game's
 * `screen` off the panel would otherwise be answered by a phase the build never
 * registered.
 */
const ENGINE_WORLD = /^\s*level\s*:/i;

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
 * before it did not, less the engine's own two lines.
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
    .filter((line) => !ENGINE_WORLD.test(line) && !ENGINE_METRICS.test(line));
}

/**
 * The lines `after` carries that `before` did not, as a multiset difference.
 *
 * What one point needs beyond {@link overlayLines}: the panel's report of a
 * situation, less its report of the same board without that situation, so a line
 * that never changed cannot answer for one that had to.
 */
export function linesAdded(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  return after.filter((line) => {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      return false;
    }
    return true;
  });
}

/** Every maximal run of digits the lines carry, in the order they were drawn. */
export function digitRuns(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.match(/\d+/g) ?? []);
}

/** How many of the lines carry `value` as a whole figure. */
export function linesCarrying(lines: readonly string[], value: number): number {
  return lines.filter((line) =>
    (line.match(/\d+/g) ?? []).some(
      (run) => Number.parseInt(run, 10) === value,
    ),
  ).length;
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
  const carried = digitRuns(lines).filter(
    (run) => Number.parseInt(run, 10) === value,
  ).length;
  if (carried < times) {
    fail(
      times === 1
        ? `an overlay line carrying ${what} (${String(value)})`
        : `${String(times)} overlay lines carrying ${what} ` +
            `(${String(value)}), and ${String(carried)} carried it`,
      lines,
    );
  }
}

/** Some line carries `text`, ignoring case, and fails naming what was wanted. */
export function assertWord(
  lines: readonly string[],
  text: string,
  what: string,
): void {
  const wanted = text.trim().toLowerCase();
  if (!lines.some((line) => line.toLowerCase().includes(wanted))) {
    fail(`an overlay line carrying ${what} (${JSON.stringify(text)})`, lines);
  }
}
