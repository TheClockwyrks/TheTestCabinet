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
// frame, so the overlay's lines are the text the toggled frame draws OVER the
// baseline frame's: the multiset difference. The screen, the mode, and the
// board's dimensions are asserted as content — "playing", the mode's name, and
// the cols and rows of a deliberately distinctive 7x6 board. The beam length's
// FORMAT is the build's, so it is asserted as liveness instead: `clear()`
// empties every beam, and a diagnostic that reports beam length must draw
// something different once it does. Hiding the overlay must take its lines
// away again.
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
} from "../assert";
import { GEO_7X6 } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnText,
  loadBoard,
  toggleOverlay,
  traceCells,
  type Harness,
  type RefractSnapshot,
} from "../harness";

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
  // A 7x6 board — the dimensions are digits nothing else on the playing screen
  // shares — with a two-segment triangle beam for the length diagnostic.
  const board = await loadBoard(h, GEO_7X6);
  assertEqual(board.cols, 7, "the posed board is 7 wide");
  assertEqual(board.rows, 6, "and 6 tall");
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
    { col: 2, row: 2 },
  ]);

  const baseline = drawnText(await h.frameCalls());
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the board is in play");

  await toggleOverlay(h);
  const shown = drawnText(await h.frameCalls());
  await captureStill(h, "overlay");

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

  // The beam-length diagnostic is live: with every beam emptied, the overlay's
  // lines change (its format is the build's, so what is required is that some
  // line reported the length and now reports it differently).
  await h.debug.clear();
  const cleared = drawnText(await h.frameCalls());
  const clearedAdded = addedTexts(cleared, baseline);
  const changed =
    clearedAdded.some((text) => !added.includes(text)) ||
    added.some((text) => !clearedAdded.includes(text));
  assertEqual(
    changed,
    true,
    "a diagnostic reports each channel's beam length: clearing the beams changes the overlay's lines",
  );

  // Hiding the overlay takes its lines away: the frame's text draws return to
  // the baseline count.
  await toggleOverlay(h);
  const hidden = drawnText(await h.frameCalls());
  assertEqual(
    hidden.length,
    baseline.length,
    "hiding the overlay removes its diagnostics",
  );
});
