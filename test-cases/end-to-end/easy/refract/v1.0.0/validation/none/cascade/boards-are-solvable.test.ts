// cascade/boards-are-solvable — every generated board is solvable, proven by
// solving it.
//
// specs/modes/cascade.md "The generator": "Every board the generator emits is
// solvable under the rules in specs/beams.md. A board reaches the player only
// when a set of beams satisfying every rule is known to exist for it." The
// sweep solves the sequence FOR REAL: each board is read off the snapshot,
// cracked by the case's solver — derived from specs/beams.md alone, never from
// any implementation — its beams traced through the game's own pointer path,
// and the solved screen crossed through NEXT BOARD. Twenty-four boards from
// seed 1 cover the whole ladder — five boards per tier, the twentieth solve
// reaching MAX_TIER — and a twenty-fifth top-tier board is solved on camera as
// the replay, so the twenty-five-board sweep continues at the top.
//
// RESIDUAL RISK, ACCEPTED: the solver carries an expansion cap (a generous
// runaway stop, DEFAULT_MAX_EXPANSIONS = 2,000,000) so a pathological board
// cannot hang the suite. Boards within the ladder's sizes (at most 7x6, 1-3
// channels) resolve in milliseconds; a conformant generator emitting a board
// the solver cannot crack inside the cap would fail this point wrongly, and
// that risk is accepted as vanishingly small rather than hidden.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CHANNELS, MAX_TIER } from "../notation";
import { solve } from "../solver";
import {
  boardFromSnapshot,
  captureReplay,
  createHarness,
  fireAction,
  solveGenerated,
  traceCells,
  type Harness,
} from "../harness";

const SWEEP = 24;
const SEED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("solves twenty-four consecutive generated boards, through MAX_TIER and beyond", async () => {
  const sweep = await solveGenerated(h, SWEEP, SEED);

  for (const [index, verdict] of sweep.verdicts.entries()) {
    assertEqual(
      verdict.status,
      "solved",
      `the spec-derived solver's verdict on board ${index + 1}`,
    );
    assertEqual(
      sweep.afterSolve[index].solved,
      true,
      `the build accepts the traced solution to board ${index + 1}`,
    );
  }

  // The sweep really climbed: the twentieth solve reaches MAX_TIER, so boards
  // twenty-one onward were generated there and the sequence continued at the top.
  assertEqual(
    sweep.afterSolve[19].tier,
    MAX_TIER,
    "the twentieth solve reaches MAX_TIER",
  );

  // One more board at the top tier, solved on camera as the replay: the bare
  // board first, then a frame after each channel's beam lands. Pointer
  // operations drive no frames of their own, so the interleaved advances are
  // what give the recording something to show.
  await fireAction(h, "confirm");
  const verdict = await captureReplay(h, "solve", async () => {
    const snapshot = await h.snapshot();
    assertEqual(
      snapshot.screen,
      "playing",
      "NEXT BOARD hands over a fresh top-tier board",
    );
    const board = boardFromSnapshot(snapshot);
    const found = solve(board);
    await h.advance(1);
    if (found.status === "solved") {
      for (const channel of CHANNELS) {
        const route = found.beams[channel];
        if (route !== undefined && route.length > 0) {
          await traceCells(h, route);
          await h.advance(1);
        }
      }
    }
    return found;
  });

  assertEqual(
    verdict.status,
    "solved",
    "the spec-derived solver's verdict on the replayed top-tier board",
  );
  const final = await h.snapshot();
  assertEqual(final.solved, true, "the build accepts the replayed solution");
});
