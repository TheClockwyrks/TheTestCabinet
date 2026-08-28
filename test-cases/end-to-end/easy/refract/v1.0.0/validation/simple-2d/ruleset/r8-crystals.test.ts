// ruleset/r8-crystals — R8: a crystal is satisfied when all of its charges
// are spent and every crossing begun across it has been completed.
//
// The manifest item's two clauses cannot hold at once — a beam that ends on a
// crystal has an end that is not an emitter, so its own channel's beam can
// never report complete (R6) while it stands there — so the suite asserts the
// two halves on the two boards that pose each purely, and both refute the
// same shortcut: computing `solved` without the crystals' full satisfaction.
//
//   1. EVERY BEAM COMPLETE, STILL UNSOLVED: on `T2T` the beam T-2-T crosses
//      the 2-charge crystal once, completely. Every channel present reports
//      complete, yet a charge is unspent, so the crystal is unsatisfied and
//      `solved` stays false (specs/beams.md R8, R9).
//   2. A BEAM LEFT ENDING ON A CRYSTAL, THEN THE FLIP: on the CRYSTAL_END
//      fixture `T1T` the beam is left ending on the crystal — every charge
//      spent, but "a beam that ends on a crystal has begun a crossing it has
//      not completed, and leaves that crystal unsatisfied" — so `solved` is
//      false; completing the crossing (resuming and leaving to the far
//      emitter) flips `solved` true on that move (specs/beams.md R8, R9).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CRYSTAL_END } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";

/**
 * One channel over a 2-charge crystal: one crossing completes the beam and
 * leaves a charge unspent. Written in specs/board.md notation; no shared
 * fixture poses an all-beams-complete board a crystal keeps unsolved.
 */
const HALF_SPENT = "T2T";

/** Both boards are 3 columns by 1 row. */
const COLS = 3;
const ROWS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("keeps the board unsolved until every crystal is satisfied, then solves on the completing move", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // Probe 1 — every channel's beam reports complete, yet an unspent charge
  // leaves the crystal unsatisfied and the board unsolved.
  await loadBoard(h, HALF_SPENT);
  traceRoute(h, [
    [0, 0],
    [1, 0],
    [2, 0],
  ]);
  const halfSpent = h.snapshot();
  assertEqual(
    halfSpent.beams.triangle?.complete,
    true,
    "the one channel present reports its beam complete (specs/beams.md R6, R7)",
  );
  const crystal2 = halfSpent.board.nodes.find(
    (n) => n.col === 1 && n.row === 0,
  );
  assertEqual(crystal2?.spent, 1, "one of the crystal's 2 charges is spent");
  assertEqual(
    halfSpent.solved,
    false,
    "R8: solved stays false while a charge is unspent, even with every " +
      "channel's beam complete (specs/beams.md R9 reads R8)",
  );

  // Probe 2 — a beam left ending on the crystal: all charges spent, but the
  // crossing begun across it has not been completed.
  await loadBoard(h, CRYSTAL_END);
  traceRoute(h, [
    [0, 0],
    [1, 0],
  ]);
  const ending = h.snapshot();
  assertDeepEqual(
    ending.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the beam is left ending on the crystal",
  );
  const crystal1 = ending.board.nodes.find((n) => n.col === 1 && n.row === 0);
  assertEqual(crystal1?.spent, 1, "the crystal's only charge is spent");
  assertEqual(
    ending.solved,
    false,
    "R8: a beam left ending on a crystal has begun a crossing it has not " +
      "completed and leaves the crystal unsatisfied, so solved stays false " +
      "(specs/beams.md)",
  );

  // Evidence: the crystal holding the board unsolved.
  await h.advance(1);
  captureStill(h, "unsatisfied");

  // Completing the crossing — resume at the crystal end and leave to the far
  // emitter — flips solved true on that move.
  h.debug.pointerDown(at(1, 0).x, at(1, 0).y);
  h.debug.pointerMove(at(2, 0).x, at(2, 0).y);
  const completed = h.snapshot();
  assertEqual(
    completed.solved,
    true,
    "completing the crossing satisfies the crystal and flips solved true " +
      "(specs/beams.md R8, R9)",
  );
  h.debug.pointerUp();
});
