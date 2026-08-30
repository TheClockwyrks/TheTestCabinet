// Refract — instrumentation/overlay: the debug overlay reports the game, and
// watching it leaves the game as it is.
//
// specs/instrumentation.md "Diagnostics": the build registers its diagnostic
// sources through InitApi.diagnostics — at least the current screen and mode,
// the board's cols and rows, and each channel's beam length among them — and
// the engine draws one line per source when the overlay is toggled. Every
// source is a pure read, so watching the overlay leaves the game as it is.
// The toggle itself is the engine's backtick key (Backquote), dispatched on
// the engine's own input path.
//
// HOW THE LINES ARE READ. The engine draws the overlay after `render` through
// the same recorded context as everything else, so the check collects the
// text a steady frame draws WITHOUT the overlay, then the text the toggle's
// frame draws WITH it, and the difference is the overlay's lines. The board
// is 7x6 — the one dimension pair no beam length or menu figure collides
// with — carrying all three channels. The engine's own metrics line is
// dropped from that difference first: it moves every frame with the machine's
// load and is not a registered source.
//
// EACH CHANNEL'S BEAM LENGTH IS READ ONE CHANNEL AT A TIME. Its wording and
// its unit are the build's — specs/instrumentation.md fixes only that each
// channel's beam length is registered and drawn on a line, not how a build
// words or counts it — so no substring can decide it honestly. What can is
// moving one channel's beam and nothing else: for each of the three in turn,
// one segment is drawn on that channel, the panel is read, the beams are
// emptied, and the panel is read again. The board carries no crystal and each
// drawn segment runs an emitter to its own lens, short of the far emitter, so
// between the two readings the ONLY fact the game holds differently is that
// one channel's beam length — the beam is no more complete than the empty one
// was (specs/beams.md R6), no charge is spent, the board is no nearer solved,
// and emptying it does not move the pointer the panel also reports. A build
// that reports one channel and leaves the other two out fails on the channel
// it left out. `h.debug.clear()` is the debug OPERATION
// (specs/instrumentation.md, `clear()`), not the player's clear action, so the
// probe reaches the beams directly and does not lean on `tracing/clear`'s
// requirement.
//
// A CONTROL PAIR KEEPS THAT PROBE HONEST. A build may register a source that
// moves on its own — a clock, an accumulated simTime — and the panel would
// then answer "something changed" to every question ever put to it. So two
// panels are read first with nothing in the game changed between them, and the
// lines that differ across those two are the restless ones; the probe reads
// only the line positions that held still.
//
// PURITY is read off the snapshot: identical before and after the toggle,
// apart from simTime, which must advance by exactly the toggle's one frame —
// time passing is the spec's own requirement of every update, overlay or not.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  loadBoard,
  resetTo,
  seconds,
  toggleOverlay,
  traceRoute,
  type Harness,
} from "../harness";

/**
 * A 7x6 board carrying all three channels, each written as an emitter, its own
 * lens, and its other emitter along one row, with a clear row between them.
 * No crystal: a crossing would move the crystals diagnostic alongside the
 * beam's, and what the probe below needs is a board on which one beam moves
 * alone. Spec-derived, written in specs/board.md notation.
 */
const OVERLAY_BOARD = `
TtT....
.......
SsS....
.......
DdD....
.......
`;

/**
 * One segment per channel: its emitter to its own lens, stopping short of the
 * far emitter. Drawing it lengthens that channel's beam and changes nothing
 * else — a beam that reaches one emitter and a lens is no more complete than
 * an empty one (specs/beams.md R6).
 */
const CHANNEL_SEGMENTS: readonly {
  channel: string;
  route: readonly (readonly [number, number])[];
}[] = [
  {
    channel: "triangle",
    route: [
      [0, 0],
      [1, 0],
    ],
  },
  {
    channel: "square",
    route: [
      [0, 2],
      [1, 2],
    ],
  },
  {
    channel: "diamond",
    route: [
      [0, 4],
      [1, 4],
    ],
  },
];

/** The lines `after` drew beyond `before`, as a multiset difference. */
function newLines(before: string[], after: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of before) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return after.filter((line) => {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      return false;
    }
    return true;
  });
}

/**
 * The engine's own metrics line, which moves every frame and is not a
 * registered source (packages/simple-2d draws it beside the game's sources).
 */
const ENGINE_METRICS = /^frame: [\d.]+ \/ [\d.]+ \/ [\d.]+ ms$/;

/** The overlay lines a REGISTERED source drew: the engine's own dropped. */
function sources(lines: readonly string[]): string[] {
  return lines.filter((line) => !ENGINE_METRICS.test(line.trim()));
}

/** Some overlay line carries `token`, ignoring case; fails naming `what`. */
function assertSomeLine(
  lines: readonly string[],
  token: string,
  what: string,
): void {
  const wanted = token.toLowerCase();
  if (!lines.some((line) => line.toLowerCase().includes(wanted))) {
    fail(`an overlay line carrying ${what}`, lines);
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the registered diagnostics and changes nothing in the game", async () => {
  await resetTo(h, 1);
  await loadBoard(h, OVERLAY_BOARD);
  for (const { route } of CHANNEL_SEGMENTS) traceRoute(h, route);
  await h.advance(1);

  // A steady frame without the overlay, for the baseline text…
  h.calls.length = 0;
  await h.advance(1);
  const baseline = drawnText(h.calls);
  const before = h.snapshot();

  // …then the toggle's frame, with it.
  h.calls.length = 0;
  await toggleOverlay(h);
  captureStill(h, "overlay");
  const overlay = newLines(baseline, drawnText(h.calls));
  const after = h.snapshot();

  /** The registered sources' lines on the next frame, in draw order. */
  const panel = async (): Promise<string[]> => {
    h.calls.length = 0;
    await h.advance(1);
    return sources(newLines(baseline, drawnText(h.calls)));
  };

  // The diagnostics the item names: the current screen and mode (spec-fixed
  // strings) and the board's cols and rows (7 and 6, digits nothing else on
  // this board produces). Each channel's beam length is decided below.
  assertSomeLine(overlay, "playing", "the current screen, 'playing'");
  assertSomeLine(overlay, "campaign", "the current mode, 'campaign'");
  assertSomeLine(overlay, "7", "the board's cols, 7");
  assertSomeLine(overlay, "6", "the board's rows, 6");
  // And the game is as it was: every source is a pure read, so the snapshot
  // is identical across the toggle apart from simTime, which advanced by
  // exactly the toggle's one frame.
  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "watching the overlay leaves the game as it is",
  );
  assertCloseTo(
    after.simTime - before.simTime,
    seconds(1),
    6,
    "simTime advances by exactly the toggle's one frame, nothing more",
  );

  // The control pair: two panels with nothing in the game changed between
  // them. A line position that differs across these two is one a source moves
  // by itself, and the probe below does not read it.
  const idleA = await panel();
  const idleB = await panel();
  const steady = (index: number): boolean =>
    index < idleA.length &&
    index < idleB.length &&
    idleA[index] === idleB[index];

  // Each channel's beam length, one channel at a time: with one segment drawn
  // on that channel alone, emptying it must move a line the panel holds still.
  for (const { channel, route } of CHANNEL_SEGMENTS) {
    h.debug.clear();
    traceRoute(h, route);
    const drawn = await panel();
    h.debug.clear();
    const emptied = await panel();
    const moved = drawn.filter(
      (line, index) => steady(index) && emptied[index] !== line,
    );
    if (moved.length === 0) {
      fail(
        `an overlay line reporting the ${channel} beam's length: one segment ` +
          "was drawn on that channel and nothing else in the game moved, so " +
          "emptying it must change a line the panel otherwise holds still " +
          "(specs/instrumentation.md, Diagnostics: each channel's beam " +
          "length is registered and drawn on a line)",
        { drawn, emptied },
      );
    }
  }
});
