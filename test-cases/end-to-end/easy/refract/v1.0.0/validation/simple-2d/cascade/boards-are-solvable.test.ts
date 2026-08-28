// Refract — cascade/boards-are-solvable: every generated board is solvable.
//
// specs/modes/cascade.md "The generator": every board the generator emits is
// solvable under the rules in specs/beams.md — a board reaches the player only
// when a set of beams satisfying every rule is known to exist for it. The
// check proves it the only honest way: it SOLVES the sequence for real.
// Twenty-five consecutive boards from a fixed seed — the tier ladder puts
// solves 21..25 at MAX_TIER (5), so the sweep reaches the top tier and
// continues there — are each read off the snapshot, solved by the solver,
// and the found beams drawn through `trace`; the game's own R9 is what says
// each board is solved.
//
// Documented residual risk: the solver is capped (DEFAULT_MAX_EXPANSIONS, a
// generous runaway stop), so a conformant generator could in principle emit a
// board the cap abandons; a `limit` verdict is reported distinctly from
// `unsolvable`. Every board within the tier ladder's stated shapes resolves
// in milliseconds in practice.
//
// The replay records the twenty-fifth board — a MAX_TIER board — being
// solved: the recorder is armed around the solve alone, never around the
// twenty-four solves that got there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  captureReplay,
  createHarness,
  oracleBoard,
  resetTo,
  solveGenerated,
  startCascade,
  tapAction,
  type Harness,
} from "../harness";
import { CHANNELS, MAX_TIER } from "../notation";
import { solve } from "../solver";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("solves twenty-five consecutive generated boards, reaching MAX_TIER and continuing there", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  // Boards 1..24, each proven solvable by solving it.
  await solveGenerated(h, 24);

  // The twenty-fifth board: generated past the twentieth solve, so at
  // MAX_TIER.
  await tapAction(h, "confirm"); // NEXT BOARD (specs/modes/cascade.md)
  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "playing",
    "the twenty-fifth generated board is in play",
  );
  assertEqual(
    snapshot.tier,
    MAX_TIER,
    "the sweep reaches MAX_TIER and continues there " +
      "(specs/modes/cascade.md tier ladder)",
  );

  await captureReplay(h, "solve", async () => {
    const board = oracleBoard(snapshot);
    const result = solve(board);
    if (result.status !== "solved") {
      fail(
        "a solvable generated board (specs/modes/cascade.md: every board " +
          "the generator emits is solvable; the spec-derived solver " +
          `reported '${result.status}' after ${result.expansions} expansions)`,
        board,
      );
    }
    // Channel by channel, a frame between, so the recording shows the solve
    // arriving rather than one finished still.
    for (const channel of CHANNELS) {
      const beam = result.beams[channel];
      if (beam === undefined || beam.length === 0) continue;
      h.debug.trace(beam.map((cell) => ({ col: cell.col, row: cell.row })));
      await h.advance(1);
    }
    assertEqual(
      h.snapshot().screen,
      "solved",
      "the twenty-fifth board is solved by the solver's beams (specs/beams.md R9)",
    );
    await h.advance(2);
  });
});
