// Facet — board/board-rests: a posed board stands exactly as it was written for
// as long as no swap is accepted on it, even with a maximal run already on it.
//
// WHAT IS BEING DECIDED. specs/rules.md begins a chain from an ACCEPTED SWAP and
// from nothing else: an accepted swap puts the board into `swapping`, and
// `SWAP_SECONDS` later `phase` becomes `resolving`, `chainStep` becomes 1 and
// step 1 resolves; every further step is read only while `phase` is `resolving`.
// There is no rule that sweeps an idle board for runs. specs/instrumentation.md
// draws the consequence for `loadBoard` in as many words — "a posed board rests
// exactly as it was written until a swap is accepted on it".
//
// A build that instead scans the board each frame and clears whatever it finds
// looks correct while it is playing, because in play a run only ever appears at
// the end of a step that was already resolving. It is a posed board that tells
// the two apart, which is why this point exists and why the board it poses
// CARRIES A RUN: three rubies in a row, sitting there, with the game left to run
// for twelve times `STEP_SECONDS` of game time. A board that self-resolves clears
// them and scores; a board that rests is unchanged to the cell.
//
// WHY THE FILLER IS THE ONE WITH AN ESCAPE SWAP. The quiet filler carries no
// legal swap of its own, and specs/rules.md ends the round when a chain settles
// on a board with no legal swap left. Posing over `quietRowsWithEscape` puts one
// legal swap in the far corner, so the board this point leaves standing is a
// board a round could still be played on — and nothing about the reading below
// depends on an end condition that was never evaluated.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBoardEquals,
  legalSwapExists,
  maximalRuns,
  quietRowsWithEscape,
  renderBoard,
  type PlacedToken,
} from "../board";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { FRAMES_PER_STEP, MATCH_MIN, STEP_SECONDS } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

/**
 * A horizontal run of three rubies, in the middle of the board and clear of the
 * escape swap's corner.
 *
 * The filler at `(1,2)` is a sapphire and at `(5,2)` a citrine, so the three are
 * bounded by another kind at each end and the run is maximal under R4 — exactly
 * `MATCH_MIN` long, the shortest thing a chain step could seed itself from.
 */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 2, token: "R0" },
  { col: 3, row: 2, token: "R0" },
  { col: 4, row: 2, token: "R0" },
];

/** The board posed: the quiet filler, one spare legal swap, and the run. */
const POSED = quietRowsWithEscape(RUN_CELLS);

/**
 * How long the board is left standing: twelve times `STEP_SECONDS`, three
 * seconds of game time.
 *
 * Twelve rather than one because a build that resolves an idle board might do it
 * on its own cadence rather than the chain's; three seconds is several times the
 * longest hold any single step can carry, so any cadence tied to the step's own
 * timing has fired repeatedly.
 */
const RESTING_STEPS = 12;
const RESTING_FRAMES = FRAMES_PER_STEP * RESTING_STEPS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it(`stands unchanged with a run on it for ${RESTING_STEPS * STEP_SECONDS}s of game time`, async () => {
  // The fixture is checked here, on this side, before it crosses into the build:
  // the point is worthless unless the board really does carry a run for the build
  // to have wrongly resolved, and really does leave the round a move to play.
  const runs = maximalRuns(POSED);
  assertLength(runs, 1, "maximal runs on the posed board");
  assertLength(runs[0].cells, MATCH_MIN, "cells in the posed run");
  assertTrue(legalSwapExists(POSED), "a legal swap exists on the posed board");

  const before = loadBoard(h, POSED);
  assertEqual(before.phase, "idle", "phase at the moment the board is posed");
  assertEqual(
    before.chainStep,
    0,
    "chainStep at the moment the board is posed",
  );

  // Nothing is requested and nothing is pressed: game time simply passes.
  await h.advance(RESTING_FRAMES);
  captureStill(h, "resting");
  const after = h.snapshot();

  // Every cell as it was written. A build that seeded a step from the standing
  // run cleared those three cells, raised the strain of their neighbors and
  // refilled the column from the top, so the first differing cell this names is
  // the one that says what it did.
  assertBoardEquals(
    renderBoard(after),
    POSED,
    `the board after ${RESTING_STEPS} steps of game time`,
  );

  // And no chain ever began. `score` is the reading that cannot be explained
  // away: specs/rules.md scores every cell a step clears, so a step that ran and
  // then tidied up after itself still banked its points.
  assertEqual(after.phase, "idle", "phase");
  assertEqual(after.chainStep, 0, "chainStep");
  assertEqual(after.score, before.score, "score");
});
