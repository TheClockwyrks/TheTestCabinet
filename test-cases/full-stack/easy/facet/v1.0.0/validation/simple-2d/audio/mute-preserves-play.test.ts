// Facet — audio/mute-preserves-play: with sound muted from the mute key, a
// drive reaches the place the rules put it.
//
// specs/ui.md, under Audio: "Muting and the first-interaction unlock belong to
// the runtime. The game binds the `mute` action to the runtime's mute bit and
// toggles it from any screen, then mirrors that bit into `state.muted` every
// frame. The game stays fully playable with sound muted." The last sentence is
// this point, and "fully playable" is read the only way it can be decided
// without opinion: a muted round is the round specs/rules.md describes.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. One harness is stood up, the key
// specs/controls.md binds to `mute` is pressed, and the identical scenario every
// chain point drives is played out: a board carrying one planted run, the swap
// that completes it requested, and its chain carried to the end. Afterwards the
// board, `screen`, `phase`, `chainStep`, `score`, `levelScore`, `level`, the
// four figures the last step left (`lastCleared`, `lastPoints`, `lastWaves`,
// `lastFall`), the level's `bestMove` and `bestChain`, `legalSwap`, the
// selection and the offer all have to be what the rules give for that one
// step, and `muted` has to still be `true`. A build that stops advancing the
// board, refuses the swap, or skips the step's scoring while its bus is silent
// fails here on the figure it lost.
//
// WHY THE REFILL IS POSED. R9 draws a refill's kind at random, so what lands in
// the three cells the step empties is the build's and could complete a run of
// its own. The refill is posed through `setRefillKinds` on the three columns
// with kinds that complete no run, so the chain is exactly one step long and the
// board it settles on can be stated.
//
// SILENCE ITSELF IS NOT READ, deliberately. specs/ui.md puts muting on the
// RUNTIME rather than on the game, so a muted frame is entitled to raise its cue
// and let the runtime's own bus zero it — and under `none` that bus is a layer
// inside the build that nothing outside can see. Asserting that a muted drive
// made no sound would fail a build that muted exactly as the specification says
// to. What is asserted is the game, which is what the sentence is about.
//
// THE RESTING VALUE IS NOT ASSUMED. The specification never says which way the
// runtime's mute bit rests when a build opens, so the drive is brought to muted
// with at most one press of the toggle and then checked, rather than being
// assumed to start unmuted.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNull,
  assertTrue,
} from "../assert";
import {
  clearSetFromRuns,
  hasAnyRun,
  legalSwapExists,
  maximalRuns,
  quietRowsWithEscape,
  renderBoard,
  settleBoard,
  swapIsLegal,
  swapped,
  WILDCARD,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import { BASE_SCORE, GRID_COLS } from "../constants";
import {
  captureReplay,
  createHarness,
  loadBoard,
  poseRefill,
  requestSwap,
  resolveChain,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 3, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
];

/** The cell the waiting ruby sits on, and the cell the swap drops it into. */
const FROM: CellRef = { col: 5, row: 2 };
const TO: CellRef = { col: 5, row: 3 };

/**
 * What the refill deals into the three columns the step empties, top down.
 *
 * Each letter is chosen so the refilled gem completes no run with its
 * neighbors, which is proved over the settled board below rather than trusted.
 */
const REFILL: readonly (readonly [col: number, kinds: string])[] = [
  [3, "C"],
  [4, "S"],
  [5, "M"],
];

/** The refill pose in the snapshot's own shape, for `settleBoard`. */
const REFILL_KINDS: readonly string[] = Array.from(
  { length: GRID_COLS },
  (_, col) => REFILL.find(([at]) => at === col)?.[1] ?? "",
);

/** Three plain rubies at multiplier 1: the one step's points. */
const STEP_POINTS = 3 * BASE_SCORE;

/** The kind letter at each cell, so R7's strain digit is left to its own points. */
function kindsOf(rows: BoardRows): string[] {
  return rows.map((row) =>
    row
      .trim()
      .split(/\s+/)
      .map((token) => (token === WILDCARD ? token : token[0]))
      .join(" "),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Bring the build's mute bit to `true` with at most one press of the bound key,
 * and prove it got there.
 *
 * The toggle is what specs/controls.md fixes ("`mute` — Toggles the runtime's
 * mute bit"), and the resting value is fixed nowhere, so the state is reached
 * rather than assumed. A frame follows the press because specs/instrumentation.md
 * has the game mirror the bit into `muted` every frame.
 */
async function mute(): Promise<void> {
  if (!h.snapshot().muted) {
    await h.tapAction("mute");
    await h.advance(1);
  }
  assertEqual(h.snapshot().muted, true, "the mute bit the drive runs under");
}

it("reaches the board, score, phase and figures the rules give with sound muted", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  // The fixture is what it claims before the build is asked anything: no run on
  // the posed board, a legal exchange, exactly one run made by it, and a refill
  // that leaves the settled board with no run of its own, so the chain is one
  // step long.
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    swapIsLegal(posed, FROM, TO),
    "the scenario's exchange is legal under R1 and R3",
  );
  const exchanged = swapped(posed, FROM, TO);
  assertLength(maximalRuns(exchanged), 1, "maximal runs the exchange produces");
  const cleared = clearSetFromRuns(exchanged);
  assertLength(cleared, 3, "cells the one step clears");
  const settled = settleBoard(exchanged, cleared, REFILL_KINDS);
  assertTrue(
    settled.rows.every((row) => !row.includes(WILDCARD)),
    "every refilled cell is posed",
  );
  assertEqual(hasAnyRun(settled.rows), false, "a run on the settled board");

  // A real gesture first, so a build that withholds audio until the player has
  // interacted is in the state it would be in under a hand.
  await h.armAudio();
  await mute();

  loadBoard(h, posed);
  poseRefill(h, REFILL);
  const originTime = h.snapshot().simTime;

  const outcome = await captureReplay(h, "muted", async () => {
    const requested = requestSwap(h, FROM, TO);
    assertEqual(
      requested.phase,
      "swapping",
      "the phase the accepted swap opened",
    );
    return resolveChain(h);
  });
  assertTrue(outcome.settled, "the chain returned to idle within the cap");
  const s = outcome.snapshot;

  // The one field a muted drive is entitled to differ in, still set.
  assertEqual(s.muted, true, "the mute bit the drive ran under");

  // The board, kind for kind, as R9 leaves it after the one step, with the
  // gems above the cleared row fallen into it and the posed refill on top.
  assertDeepEqual(
    kindsOf(renderBoard(s)),
    kindsOf(settled.rows),
    "the kinds on the board the muted drive settled on",
  );

  // Every figure the round is played for, as specs/rules.md sets it after one
  // step of three plain gems: the round goes on, the chain has settled, and the
  // step's points reached every accumulation they are added to.
  assertEqual(s.screen, "playing", "the screen");
  assertEqual(s.phase, "idle", "the phase");
  assertEqual(s.chainStep, 0, "the chain step");
  assertEqual(s.level, 1, "the level");
  assertEqual(s.score, STEP_POINTS, "the score");
  assertEqual(s.levelScore, STEP_POINTS, "the level score");
  assertEqual(s.lastCleared, 3, "the cells the last step cleared");
  assertEqual(s.lastPoints, STEP_POINTS, "the points the last step scored");
  assertEqual(s.lastWaves, 0, "the waves the last step's clear set carried");
  assertGreaterThan(s.lastFall, 0, "the longest fall the last step left");
  assertEqual(s.bestMove, STEP_POINTS, "the level's best move");
  assertEqual(s.bestChain, 1, "the level's longest chain");
  assertEqual(
    s.legalSwap,
    legalSwapExists(settled.rows),
    "whether a legal swap remains",
  );
  assertNull(s.selection, "the selection");
  assertNull(s.offer, "the offer");

  // And the drive itself covered game time: the swap's own span and the step's
  // hold both ran off the clock while the bus was silent.
  assertGreaterThan(
    s.simTime - originTime,
    0,
    "the game time the drive covered from the posed board",
  );
});
