// Refract — instrumentation/overlay: the game registers the diagnostics the
// specification asks for, and reading them leaves the game as it is.
//
// specs/instrumentation.md "Diagnostics": the build registers its diagnostic
// sources through `world.diagnostics` in the game mode's `beginPlay` — the
// current `screen` and `mode`, the board's `cols` and `rows`, and each
// channel's beam length among them — and keeps every source a pure read.
// Registering those values is the whole of Refract's part; drawing the panel
// and toggling it are the engine's. So nothing here toggles the overlay,
// presses a key, or reads a drawn line: the check reads the registry itself,
// through `engine.diagnostics()`, which evaluates every registered source and
// reports what each one returned.
//
// WHAT IS ASSERTED, AND HOW LOOSELY. The specification fixes the FACTS a source
// must report, not the wording a build names them with, so a reading is looked
// up by the specification's own word for its fact — `screen`, `mode`, the
// board's `cols` and `rows`, and each channel name from specs/board.md — and
// its VALUE is held against what the posed state implies. A beam's length is
// honestly counted in cells or in segments, so each length is accepted under
// either count, and a value that carries other words around the figure (a unit,
// a completeness flag) still reports it.
//
// THE POSED STATE. A 7x6 board carrying all three channels, on the `playing`
// screen in `campaign` mode, with a 2-cell triangle beam, a 3-cell square beam,
// and the diamond beam left empty.
//
// PURITY. Every source is a pure read, so a read leaves the snapshot exactly as
// it was — no frame runs here, so simTime is held too — and a second read with
// nothing in between reports the same values.

import type { DiagnosticReading } from "@clockwyrks/structured-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  toCells,
  traceCells,
  type Harness,
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

/** A route as `routes.ts` stores it: ordered `[col, row]` pairs. */
type RoutePairs = ReadonlyArray<readonly [number, number]>;

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

/** The readings whose name carries any of the specification's words for a fact. */
function namedFor(
  readings: readonly DiagnosticReading[],
  words: readonly string[],
): DiagnosticReading[] {
  return readings.filter((reading) => {
    const name = reading.name.toLowerCase();
    return words.some((word) => name.includes(word));
  });
}

/** A reading's value as the text a reader of the panel sees. */
function valueText(reading: DiagnosticReading): string {
  return String(reading.value).toLowerCase();
}

/** Every whole number written in a reading's value. */
function figuresIn(reading: DiagnosticReading): number[] {
  return (String(reading.value).match(/\d+/g) ?? []).map(Number);
}

/** The readings named for `requirement`, or a failure naming the whole set. */
function sourcesFor(
  readings: readonly DiagnosticReading[],
  words: readonly string[],
  requirement: string,
): DiagnosticReading[] {
  const found = namedFor(readings, words);
  if (found.length === 0) {
    fail(`a registered diagnostic named for ${requirement}`, lines(readings));
  }
  return found;
}

/** Some source named for `requirement` reports a value carrying `token`. */
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

/** Some source named for `requirement` reports one of `figures`. */
function assertReportsFigure(
  readings: readonly DiagnosticReading[],
  words: readonly string[],
  figures: readonly number[],
  requirement: string,
): void {
  const sources = sourcesFor(readings, words, requirement);
  const reported = sources.some((reading) =>
    figuresIn(reading).some((figure) => figures.includes(figure)),
  );
  if (!reported) {
    fail(`${requirement} reported as ${figures.join(" or ")}`, lines(sources));
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
  traceCells(h, toCells(TRIANGLE_ROUTE));
  traceCells(h, toCells(SQUARE_ROUTE));
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
});
