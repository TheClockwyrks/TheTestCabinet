// Refract — instrumentation/overlay: the game registers the diagnostics the
// specification asks for, and reading them leaves the game as it is.
//
// specs/instrumentation.md "Diagnostics": the build registers its diagnostic
// sources through `InitApi.diagnostics` — the current `screen` and `mode`, the
// board's `cols` and `rows`, and each channel's beam length among them — and
// keeps every source a pure read. Registering those values is the whole of
// Refract's part; drawing the panel, toggling it, and keeping it read-only are
// the engine's. So nothing here toggles the overlay, presses a key, or reads a
// drawn line: the check reads the registry itself, through
// `engine.diagnostics()`, which evaluates every registered source against the
// current state and reports what each one returned.
//
// WHAT IS ASSERTED, AND HOW LOOSELY. The specification fixes the FACTS a source
// must report, not the wording a build names them with nor how many sources it
// spreads them over, so a reading is looked up by the specification's own word
// for its fact — `screen`, `mode`, the board's `cols` and `rows`, and each
// channel name from specs/board.md — in the LINE the panel shows, which is
// the source's name and its value together. A build reporting all three beam
// lengths under one `beams` source is read the same way as one registering a
// source per channel, and each channel's figure is read from its own stretch of
// that line, so no channel answers for another. A beam's length is honestly
// counted in cells or in segments, so each length is accepted under either
// count, and a value that carries other words around the figure (a unit, a
// completeness flag) still reports it. A loose reading is held honest by
// reading the three lengths in TWO states: a source is a read of the state
// (specs/instrumentation.md: "Each source is called with the state current at
// the read ... and reads off that argument"), so a line that names the
// channels beside figures it does not read off the game answers correctly in
// at most one of them.
//
// THE POSED STATE. A 7x6 board carrying all three channels, on the `playing`
// screen in `campaign` mode, with a 2-cell triangle beam, a 3-cell square beam,
// and the diamond beam left empty. The same board is then posed afresh, which
// empties every beam, and the three lengths are read again.
//
// PURITY. Every source is a pure read, so a read leaves the snapshot exactly as
// it was — no frame runs here, so simTime is held too — and a second read with
// nothing in between reports the same values.

import type { DiagnosticReading } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  traceRoute,
  type Harness,
  type RoutePairs,
} from "../harness";
import { CHANNELS, type Channel } from "../notation";

/**
 * A 7x6 board carrying all three channels: adjacent triangle emitters, a square
 * emitter-lens-emitter run, and diamond emitters too far apart for any segment.
 * Spec-derived, written in specs/board.md notation.
 */
const OVERLAY_BOARD = `
TT.....
SsS....
D.....D
.......
.......
.......
`;

/** The posed board's dimensions, counted off the notation above. */
const COLS = 7;
const ROWS = 6;

/** The routes drawn on it, one per channel that can carry a segment. */
const TRIANGLE_ROUTE: RoutePairs = [
  [0, 0],
  [1, 0],
];
const SQUARE_ROUTE: RoutePairs = [
  [0, 1],
  [1, 1],
  [2, 1],
];

/** Cells each channel's beam ends up joining; the diamonds carry no segment. */
const BEAM_CELLS: Readonly<Record<Channel, number>> = {
  triangle: TRIANGLE_ROUTE.length,
  square: SQUARE_ROUTE.length,
  diamond: 0,
};

/** One reading as a line, so a failure names what the build did register. */
function lines(readings: readonly DiagnosticReading[]): string[] {
  return readings.map((reading) =>
    reading.error === undefined
      ? `${reading.name} = ${String(reading.value)}`
      : `${reading.name} threw: ${reading.error}`,
  );
}

/** A reading's name as the text a reader of the panel sees. */
function nameText(reading: DiagnosticReading): string {
  return reading.name.toLowerCase();
}

/**
 * A reading's value as the text a reader of the panel sees, with a hyphen that
 * joins a word to a figure read as the separator it is rather than as a sign.
 *
 * A build grouping several facts on one line may delimit each word from its
 * own figure with a hyphen — `triangle-1 square-2 diamond-0` — and reading
 * that hyphen as a sign would report the triangle beam at -1 and fail a line
 * that says 1. A hyphen anywhere a sign can stand is left exactly as it is, so
 * `diamond:-1` and a bare `-1` still report -1, which is what a build
 * reporting an empty beam as -1 must be shown to have said.
 */
function valueText(reading: DiagnosticReading): string {
  return String(reading.value)
    .toLowerCase()
    .replace(/(\w)-(?=\d)/g, "$1 ");
}

/**
 * The readings that report a fact, looked up by the specification's own word
 * for it in the LINE the panel shows — the source's name and its value
 * together.
 *
 * specs/instrumentation.md asks for the facts, not for one source per fact:
 * "Register at least the current `screen` and `mode`, the board's `cols` and
 * `rows`, each channel's beam length and whether it is complete". A build that
 * groups the three beam lengths under one source does register each channel's
 * length, and names each channel in the value rather than in the name, so a
 * lookup that read the name alone would miss a reading that is plainly there.
 */
function namedFor(
  readings: readonly DiagnosticReading[],
  words: readonly string[],
): DiagnosticReading[] {
  return readings.filter((reading) => {
    const line = `${nameText(reading)} ${valueText(reading)}`;
    return words.some((word) => line.includes(word));
  });
}

/** Every whole number written in `text`, a leading minus sign included. */
function figuresIn(text: string): number[] {
  return (text.match(/-?\d+/g) ?? []).map(Number);
}

/**
 * The stretch of a value each word it names reports, under one reading of the
 * whole line.
 *
 * A source reporting several facts at once writes each figure beside its own
 * word, and which side it writes it on is a wording the build chooses once for
 * the line: `triangle:1 square:2 diamond:0` puts each figure after its word,
 * `1 on triangle, 2 on square, 0 on diamond` before it. So both readings are
 * laid out and the line is read under the one that gives EVERY word it names a
 * figure of its own, which is what a line reporting each of them looks like
 * either way round. Reading the line one word at a time instead would take a
 * neighbour's figure for a word whose own side of it is bare.
 */
function stretches(
  value: string,
  words: readonly string[],
): Map<string, string> {
  const found = words
    .map((word) => ({ word, at: value.indexOf(word) }))
    .filter((entry) => entry.at !== -1)
    .sort((a, b) => a.at - b.at);
  const forward = new Map<string, string>();
  const backward = new Map<string, string>();
  found.forEach((entry, index) => {
    const next = found[index + 1];
    const previous = found[index - 1];
    forward.set(
      entry.word,
      value.slice(entry.at + entry.word.length, next?.at ?? value.length),
    );
    backward.set(
      entry.word,
      value.slice(
        previous === undefined ? 0 : previous.at + previous.word.length,
        entry.at,
      ),
    );
  });
  const reportsEach = (spans: Map<string, string>): boolean =>
    [...spans.values()].every((text) => figuresIn(text).length > 0);
  return reportsEach(forward) || !reportsEach(backward) ? forward : backward;
}

/** The figures a reading reports for `words`, each read in its own stretch. */
function reportedFigures(
  reading: DiagnosticReading,
  words: readonly string[],
  siblings: readonly string[],
): number[] {
  const value = valueText(reading);
  const present = words.filter((word) => value.includes(word));
  if (present.length === 0) return figuresIn(value);
  const spans = stretches(value, siblings);
  return present.flatMap((word) => figuresIn(spans.get(word) ?? value));
}

/** The readings reporting `requirement`, or a failure naming the whole set. */
function sourcesFor(
  readings: readonly DiagnosticReading[],
  words: readonly string[],
  requirement: string,
): DiagnosticReading[] {
  const found = namedFor(readings, words);
  if (found.length === 0) {
    fail(`a registered diagnostic reporting ${requirement}`, lines(readings));
  }
  return found;
}

/** Some source reporting `requirement` carries `token` in its value. */
function assertReportsText(
  readings: readonly DiagnosticReading[],
  words: readonly string[],
  token: string,
  requirement: string,
): void {
  const sources = sourcesFor(readings, words, requirement);
  if (!sources.some((reading) => valueText(reading).includes(token))) {
    fail(`${requirement} reported as ${JSON.stringify(token)}`, lines(sources));
  }
}

/**
 * Some source reporting `requirement` writes one of `figures` for it.
 *
 * `siblings` are the words a build may report alongside this one on a single
 * line, which is what bounds the stretch a figure is read from: without them
 * one channel's figure would answer every channel's question.
 */
function assertReportsFigure(
  readings: readonly DiagnosticReading[],
  words: readonly string[],
  figures: readonly number[],
  requirement: string,
  siblings: readonly string[] = words,
): void {
  const sources = sourcesFor(readings, words, requirement);
  const reported = sources.some((reading) =>
    reportedFigures(reading, words, siblings).some((figure) =>
      figures.includes(figure),
    ),
  );
  if (!reported) {
    const wanted = [...new Set(figures)].join(" or ");
    fail(`${requirement} reported as ${wanted}`, lines(sources));
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("registers the diagnostics the specification asks for, and reading them changes nothing", async () => {
  await resetTo(h);
  await loadBoard(h, OVERLAY_BOARD);
  traceRoute(h, TRIANGLE_ROUTE);
  traceRoute(h, SQUARE_ROUTE);
  await h.advance(1);

  // Evidence: the posed board the diagnostics below are read from.
  captureStill(h, "overlay");

  const before = h.snapshot();
  const readings = h.engine.diagnostics();

  // Something was registered, and every source returned rather than threw: a
  // source that throws is neither a value the panel can show nor a pure read.
  assertGreaterThan(
    readings.length,
    0,
    "the build registers diagnostic sources with the engine",
  );
  const threw = readings.filter((reading) => reading.error !== undefined);
  assertDeepEqual(lines(threw), [], "every registered source returns a value");

  // The facts specs/instrumentation.md names, each held against what the posed
  // state implies. The screen and the mode are spec-fixed strings; the board's
  // cols and rows are the notation's own 7 and 6.
  assertReportsText(readings, ["screen"], "playing", "the current screen");
  assertReportsText(readings, ["mode"], "campaign", "the current mode");
  const boardWords = ["board", "cols", "rows"];
  assertReportsFigure(readings, boardWords, [COLS], "the board's cols");
  assertReportsFigure(readings, boardWords, [ROWS], "the board's rows");

  // Each channel's beam length, counted in cells or in segments.
  for (const channel of CHANNELS) {
    const cells = BEAM_CELLS[channel];
    assertReportsFigure(
      readings,
      [channel],
      [cells, Math.max(0, cells - 1)],
      `the ${channel} beam's length`,
      CHANNELS,
    );
  }

  // A pure read: the game is exactly as it was, down to simTime, since reading
  // the sources runs no frame.
  assertDeepEqual(
    h.snapshot(),
    before,
    "reading the diagnostics leaves the game as it is",
  );

  // And it reports the same values again, with nothing between the two reads.
  assertDeepEqual(
    lines(h.engine.diagnostics()),
    lines(readings),
    "a second read of the same state reports the same values",
  );

  // Each channel's beam length once more, with the same board posed afresh so
  // every beam on it is empty. specs/instrumentation.md fixes each source as a
  // read OF THE STATE — "Each source is called with the state current at the
  // read ... and reads off that argument" — and `loadBoard` "poses an
  // arbitrary board and moves to `playing` with every beam empty", so a source
  // reporting a beam's length reports none of it here. Reading the lengths in
  // a second state is what separates a source that reads them off the game
  // from a line that merely names the channels beside figures, which a reading
  // taken in one state alone cannot tell apart. The `none` copy of this item
  // runs the same probe the other way about, emptying one channel at a time.
  await loadBoard(h, OVERLAY_BOARD);
  const emptied = h.engine.diagnostics();
  for (const channel of CHANNELS) {
    assertReportsFigure(
      emptied,
      [channel],
      [0],
      `the ${channel} beam's length with the board posed afresh, every beam empty`,
      CHANNELS,
    );
  }
});
