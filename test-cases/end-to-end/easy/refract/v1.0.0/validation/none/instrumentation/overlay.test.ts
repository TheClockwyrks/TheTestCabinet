// Refract — instrumentation/overlay: the debug overlay reports the game, and
// watching it leaves the game as it is.
//
// UNDER THIS ENGINE THE OVERLAY IS THE BUILD'S OWN RUNTIME LAYER, toggled by
// the one binding the specification fixes for it: the backtick key
// (`Backquote`). What it must show is the diagnostics `specs/instrumentation.md`
// asks the game to register — at least the current screen and mode, the board's
// cols and rows, and each channel's beam length — and every source must be a
// pure read.
//
// HOW THE DIAGNOSTICS ARE READ. The recorder hands back every text draw of one
// frame, coalesced into logical runs, so the overlay's lines are the text the
// toggled frame draws OVER the baseline frame's: the multiset difference. The
// runs are what is read, not the raw draws, because letter-spacing canvas text
// means one `fillText` per glyph and how a line is typeset is the build's. The
// screen, the mode, and the board's dimensions are asserted as content —
// "playing", the mode's name, and the cols and rows of a deliberately
// distinctive 7x6 board.
//
// EACH CHANNEL'S BEAM LENGTH IS READ ONE CHANNEL AT A TIME. Its wording and
// its unit are the build's — specs/instrumentation.md fixes only that each
// channel's beam length is registered and drawn on a line — so no substring
// can decide it honestly. What can is moving one channel's beam and nothing
// else: for each of the three in turn, one segment is drawn on that channel,
// the panel is read, `clear()` empties it, and the panel is read again. The
// probe board carries no crystal and each drawn segment runs an emitter to its
// own lens, short of the far emitter, so between the two readings the ONLY
// fact the game holds differently is that one channel's beam length — the beam
// is no more complete than the empty one was, no charge is spent, the board is
// no nearer solved, and `clear()` does not move the pointer the panel also
// reports. A build that reports one channel and leaves the other two out fails
// on the channel it left out. `h.debug.clear()` is the debug OPERATION
// (specs/instrumentation.md, `clear()`), not the player's clear action, so the
// probe reaches the beams directly and does not lean on `tracing/clear`'s
// requirement.
//
// A CONTROL PAIR KEEPS THAT PROBE HONEST. This engine's overlay is the build's
// own, and a panel may carry a heading that moves every frame by itself — a
// frame counter, a delta, a clock. So two panels are read first with nothing
// in the game changed between them, and the lines that differ across those two
// are the restless ones; the probe reads only the line positions that held
// still. Without it a panel with a frame counter would answer "something
// changed" to every question ever put to it.
//
// "IDENTICAL BEFORE AND AFTER" IS READ OVER THE GAME-FACING FIELDS. Delivering
// the toggle key needs a frame (a press must be held across one to be seen),
// so `simTime` necessarily moves and the mirrored `pointer` refreshes; what a
// pure read must not move is everything the game itself holds — screen, mode,
// menus, progress, board, beams, solved, tracing, muted.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertMatches,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextLines,
  loadBoard,
  toggleOverlay,
  traceRoute,
  type Harness,
  type RefractSnapshot,
} from "../harness";

/**
 * A 7x6 board carrying all three channels, each written as an emitter, its own
 * lens, and its other emitter along one row, with a clear row between them. 7
 * and 6 are digits nothing else on the playing screen shares. No crystal: a
 * crossing would move the crystals diagnostic alongside the beam's, and what
 * the probe below needs is a board on which one beam moves alone.
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The fields the game itself holds — everything but simTime and pointer. */
function gameFacing(snapshot: RefractSnapshot): Partial<RefractSnapshot> {
  const { simTime: _simTime, pointer: _pointer, ...rest } = snapshot;
  return rest;
}

/** The strings in `texts` left after removing `baseline`, as a multiset. */
function addedTexts(texts: string[], baseline: string[]): string[] {
  const remaining = [...baseline];
  return texts.filter((text) => {
    const at = remaining.indexOf(text);
    if (at === -1) return true;
    remaining.splice(at, 1);
    return false;
  });
}

it("draws the asked-for diagnostics, purely, and hides them again", async () => {
  // A 7x6 board carrying all three channels, one segment drawn on each, so
  // every beam-length diagnostic has a real number to report.
  const board = await loadBoard(h, OVERLAY_BOARD);
  assertEqual(board.cols, 7, "the posed board is 7 wide");
  assertEqual(board.rows, 6, "and 6 tall");
  for (const { route } of CHANNEL_SEGMENTS) await traceRoute(h, route);

  const baseline = drawnTextLines(await h.frameCalls());
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the board is in play");

  await toggleOverlay(h);
  const shown = drawnTextLines(await h.frameCalls());
  await captureStill(h, "overlay");

  /** The overlay's lines on the next frame: that frame's text less the bare. */
  const panel = async (): Promise<string[]> =>
    addedTexts(drawnTextLines(await h.frameCalls()), baseline);

  const added = addedTexts(shown, baseline);
  assertGreaterThan(added.length, 0, "the overlay draws diagnostics");
  const joined = added.join("\n").toLowerCase();
  assertMatches(joined, "playing", "the overlay reports the current screen");
  assertMatches(joined, before.mode, "the overlay reports the current mode");
  assertMatches(joined, "7", "the overlay reports the board's cols");
  assertMatches(joined, "6", "the overlay reports the board's rows");

  // A pure read: the game-facing state is identical across the toggle.
  const after = await h.snapshot();
  assertDeepEqual(
    gameFacing(after),
    gameFacing(before),
    "watching the overlay leaves the game as it is",
  );

  // The control pair: two panels with nothing in the game changed between
  // them. A line position that differs across these two is one the panel
  // moves by itself, and the probe below does not read it.
  const idleA = await panel();
  const idleB = await panel();
  const steady = (index: number): boolean =>
    index < idleA.length &&
    index < idleB.length &&
    idleA[index] === idleB[index];

  // Each channel's beam length, one channel at a time: with one segment drawn
  // on that channel alone, emptying it must move a line the panel holds still.
  for (const { channel, route } of CHANNEL_SEGMENTS) {
    await h.debug.clear();
    await traceRoute(h, route);
    const drawn = await panel();
    await h.debug.clear();
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

  // Hiding the overlay takes its lines away: the frame's text draws return to
  // the baseline count.
  await toggleOverlay(h);
  const hidden = drawnTextLines(await h.frameCalls());
  assertEqual(
    hidden.length,
    baseline.length,
    "hiding the overlay removes its diagnostics",
  );
});
