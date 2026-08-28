// Refract — cascade/seeded-sequence: a seed reproduces the same sequence.
//
// specs/modes/cascade.md "Determinism": the sequence is a function of the
// seed alone — seeding the generator with a given value and solving boards in
// order produces the same boards, in the same order, every time — and boards
// are generated one at a time as they are needed. Two passes are run from
// `reset({seed: 5})`: the first records each of six boards (as its notation)
// and the beams the spec-derived solver found for it, the second holds each
// arriving board to the recorded one and solves it with the FIRST pass's
// beams — determinism means they re-apply, and the game's own R9 saying
// `solved` on every board is what proves the sequence really repeated,
// consumption and all. The still is the first board of the second pass, the
// board the seed reproduces.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  startCascade,
  tapAction,
  traceBeams,
  type Harness,
} from "../harness";
import { boardToNotation } from "../notation";
import type { Beams } from "../rules";
import { solve } from "../solver";

const SEED = 5;
const BOARDS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces the same first six boards, in the same order, from the same seed", async () => {
  await resetTo(h, SEED);
  await startCascade(h);

  // First pass: record each board and the beams that solved it.
  const seen: { notation: string; beams: Beams }[] = [];
  for (let k = 1; k <= BOARDS; k += 1) {
    if (k > 1) {
      await tapAction(h, "confirm"); // NEXT BOARD (specs/modes/cascade.md)
    }
    const snapshot = h.snapshot();
    assertEqual(snapshot.screen, "playing", `first pass: board ${k} in play`);
    const board = oracleBoard(snapshot);
    const result = solve(board);
    if (result.status !== "solved") {
      fail(
        "a solvable generated board (specs/modes/cascade.md; the " +
          `spec-derived solver reported '${result.status}' after ` +
          `${result.expansions} expansions)`,
        board,
      );
    }
    seen.push({ notation: boardToNotation(board), beams: result.beams });
    traceBeams(h, result.beams);
    assertEqual(
      h.snapshot().screen,
      "solved",
      `first pass: board ${k} solved (specs/beams.md R9)`,
    );
    await h.advance(1);
  }

  // Second pass, same seed: the same boards arrive in the same order, and
  // the first pass's beams solve each one again.
  await resetTo(h, SEED);
  await startCascade(h);
  for (let k = 1; k <= BOARDS; k += 1) {
    if (k > 1) {
      await tapAction(h, "confirm");
    }
    const snapshot = h.snapshot();
    assertEqual(snapshot.screen, "playing", `second pass: board ${k} in play`);
    if (k === 1) captureStill(h, "board");
    const recorded = seen[k - 1];
    if (recorded === undefined) {
      return fail(`a recorded board ${k} from the first pass`, seen.length);
    }
    assertEqual(
      boardToNotation(oracleBoard(snapshot)),
      recorded.notation,
      `board ${k} of the seeded sequence is the same board, in the same ` +
        "order (specs/modes/cascade.md: the sequence is a function of the " +
        "seed alone)",
    );
    traceBeams(h, recorded.beams);
    assertEqual(
      h.snapshot().screen,
      "solved",
      `second pass: the first pass's beams solve board ${k} again ` +
        "(specs/modes/cascade.md determinism)",
    );
    await h.advance(1);
  }
});
