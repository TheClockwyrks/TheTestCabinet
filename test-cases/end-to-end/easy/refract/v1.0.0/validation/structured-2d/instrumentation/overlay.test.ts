// Refract — instrumentation/overlay: the debug overlay reports the game, and
// watching it leaves the game as it is.
//
// Under this engine the overlay is engine chrome — the backtick key toggles
// it, and the engine draws the values the game REGISTERED as diagnostic
// sources (specs/instrumentation.md, Diagnostics: at least the current screen
// and mode, the board's cols and rows, and each channel's beam length). The
// overlay draws through the same context the harness records, so its lines
// are read as ordinary text runs; the lines the toggle ADDS over an otherwise
// still playing screen are the registered sources' lines.
//
// The board is 7x6 — cols 7, rows 6, digits that appear on the board line and
// nowhere else on a quiet playing frame — and carries all three channels, one
// segment drawn on each, so every beam-length diagnostic has a real number to
// report. What exact words a build's lines use is the build's; what is
// asserted is the specification's floor: a line reporting the screen value
// (the case-fixed "playing"), a line reporting the mode value, and the board's
// cols and rows digits. The engine's own metrics line is dropped from the
// added set first: it moves every frame with the machine's load and is not a
// registered source.
//
// EACH CHANNEL'S BEAM LENGTH IS READ ONE CHANNEL AT A TIME. Its wording, its
// unit, and whether it names a channel at all are the build's —
// specs/instrumentation.md fixes only that each channel's beam length is
// registered and drawn on a line — so no substring can decide it honestly.
// What can is moving one channel's beam and nothing else: for each of the
// three in turn, one segment is drawn on that channel, the panel is read, the
// beams are emptied, and the panel is read again. The board carries no crystal
// and each drawn segment runs an emitter to its own lens, short of the far
// emitter, so between the two readings the ONLY fact the game holds
// differently is that one channel's beam length — the beam is no more complete
// than the empty one was (specs/beams.md R6), no charge is spent, the board is
// no nearer solved, and emptying it does not move the pointer the panel also
// reports. A build that reports one channel and leaves the other two out fails
// on the channel it left out. `h.debug.clear()` is the debug OPERATION
// (specs/instrumentation.md, `clear()`), not the player's clear action, so the
// probe reaches the beams directly and does not lean on `tracing/clear`'s
// requirement. It runs LAST, after the settled comparison, so the purity
// readings stand on a board this probe has not touched.
//
// A CONTROL PAIR KEEPS THAT PROBE HONEST. A build may register a source that
// moves on its own — a clock, an accumulated simTime — and the panel would
// then answer "something changed" to every question ever put to it. So two
// panels are read first with nothing in the game changed between them, and the
// lines that differ across those two are the restless ones; the probe reads
// only the line positions that held still.
//
// "The snapshot is identical before and after" is read with the one field the
// spec defines to move regardless: simTime accumulates the delta of every
// update whatever the screen, and toggling costs a frame — so simTime is
// compared as exactly that one frame's advance, and every other field must
// be identical.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertGreaterThan,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  loadBoard,
  resetTo,
  seconds,
  toggleOverlay,
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
  route: readonly { col: number; row: number }[];
}[] = [
  {
    channel: "triangle",
    route: [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
  },
  {
    channel: "square",
    route: [
      { col: 0, row: 2 },
      { col: 1, row: 2 },
    ],
  },
  {
    channel: "diamond",
    route: [
      { col: 0, row: 4 },
      { col: 1, row: 4 },
    ],
  },
];

/**
 * The engine's own metrics line, which moves every frame and is not a
 * registered source (packages/structured-2d draws it beside the game's).
 */
const ENGINE_METRICS = /^frame: [\d.]+ \/ [\d.]+ \/ [\d.]+ ms$/;

/**
 * The lines a REGISTERED source drew on this frame: the bare playing screen's
 * own text removed, and the engine's metrics line with it.
 */
function sources(
  lines: readonly string[],
  bare: ReadonlySet<string>,
): string[] {
  return lines.filter(
    (line) => !bare.has(line) && !ENGINE_METRICS.test(line.trim()),
  );
}

/** The first of `lines` containing `needle` (case-insensitive), or fail. */
function lineContaining(
  lines: readonly string[],
  needle: string,
  requirement: string,
): string {
  const wanted = needle.toLowerCase();
  const found = lines.find((line) => line.toLowerCase().includes(wanted));
  if (found === undefined) {
    fail(
      `an overlay line containing ${JSON.stringify(needle)} (${requirement})`,
      lines,
    );
  }
  return found;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("toggling draws the registered diagnostics and leaves the game as it is", async () => {
  await resetTo(h, 1);
  await loadBoard(h, OVERLAY_BOARD);
  // One drawn segment per channel, so every beam has a length to report.
  for (const { route } of CHANNEL_SEGMENTS) h.debug.trace([...route]);

  // A baseline frame of the bare playing screen's own text.
  h.calls.length = 0;
  await h.advance(1);
  const bare = new Set(drawnText(h.calls));

  const before = h.snapshot();

  // Toggle the overlay up; the frame that lands it draws the panel's lines
  // through the same recorded context.
  h.calls.length = 0;
  await toggleOverlay(h);
  const added = sources(drawnText(h.calls), bare);
  assertGreaterThan(added.length, 0, "the toggle draws new text runs");

  // Evidence: the overlay up over the posed board. (The engine draws the
  // overlay after the replay recorder's bracket closes, so a still is the
  // one capture that shows it.)
  captureStill(h, "overlay");

  // The diagnostics specs/instrumentation.md asks for, at the level the
  // specification fixes: the values, not any one build's wording.
  lineContaining(added, "playing", "the current screen");
  lineContaining(added, before.mode, "the current mode");
  lineContaining(added, "7", "the board's cols");
  lineContaining(added, "6", "the board's rows");

  // A pure read: the snapshot is identical across the toggle, simTime moving
  // by exactly the one frame the toggle ran.
  const after = h.snapshot();
  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "every field but simTime is identical with the overlay up",
  );
  assertCloseTo(
    after.simTime,
    before.simTime + seconds(1),
    6,
    "simTime advanced by exactly the toggle's one frame",
  );

  // Toggling again hides it: the added lines are gone, and the game is still
  // exactly as it was.
  h.calls.length = 0;
  await toggleOverlay(h);
  const downAgain = new Set(drawnText(h.calls));
  const lingering = added.filter((line) => downAgain.has(line));
  assertDeepEqual(lingering, [], "the overlay's lines leave with the toggle");
  const settled = h.snapshot();
  assertDeepEqual(
    { ...settled, simTime: 0 },
    { ...before, simTime: 0 },
    "every field but simTime is identical after the overlay comes down",
  );

  // Each channel's beam length, with the overlay back up.
  h.calls.length = 0;
  await toggleOverlay(h);

  /** The registered sources' lines on the next frame, in draw order. */
  const panel = async (): Promise<string[]> => {
    h.calls.length = 0;
    await h.advance(1);
    return sources(drawnText(h.calls), bare);
  };

  // The control pair: two panels with nothing in the game changed between
  // them. A line position that differs across these two is one a source moves
  // by itself, and the probe below does not read it.
  const idleA = await panel();
  const idleB = await panel();
  const steady = (index: number): boolean =>
    index < idleA.length &&
    index < idleB.length &&
    idleA[index] === idleB[index];

  // One channel at a time: with one segment drawn on that channel alone,
  // emptying it must move a line the panel otherwise holds still.
  for (const { channel, route } of CHANNEL_SEGMENTS) {
    h.debug.clear();
    h.debug.trace([...route]);
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
