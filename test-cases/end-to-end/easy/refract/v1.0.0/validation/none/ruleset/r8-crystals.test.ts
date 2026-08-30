// ruleset/r8-crystals — R8: a crystal is satisfied when all of its charges
// are spent AND every crossing begun across it has been completed; a beam
// that ends on a crystal has begun a crossing it has not completed, and
// leaves that crystal unsatisfied (specs/beams.md).
//
// The item names three observations, and no single board holds all of them: a
// beam ending on a crystal is by R6 not complete itself, so a board cannot at
// once report every beam complete and stand a crossing begun-and-not-left.
// Each half is therefore posed on the board that holds it purely, and both
// refute the same shortcut — computing `solved` without the crystals' full
// satisfaction.
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
//
// The final press lands on the sole beam's end, so the multi-beam grab rows of
// specs/controls.md's table — `tracing/grab-end-wins-over-mid`'s requirement —
// are not in play, and the resume this check depends on is the plain
// press-on-an-end row.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CRYSTAL_END } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

/**
 * One channel over a 2-charge crystal: one crossing completes the beam and
 * leaves a charge unspent. Written in specs/board.md notation; no shared
 * fixture poses an all-beams-complete board a crystal keeps unsolved.
 */
const HALF_SPENT = "T2T";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the board unsolved until every crystal is satisfied, then solves on the completing move", async () => {
  // Probe 1 — every channel's beam reports complete, yet an unspent charge
  // leaves the crystal unsatisfied and the board unsolved.
  await loadBoard(h, HALF_SPENT);
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
  ]);
  const halfSpent = await h.snapshot();
  assertEqual(
    halfSpent.beams.triangle?.complete,
    true,
    "the one channel present reports its beam complete (specs/beams.md R6, R7)",
  );
  const crystal2 = halfSpent.board.nodes.find(
    (node) => node.col === 1 && node.row === 0,
  );
  assertEqual(crystal2?.charges, 2, "the crystal carries two charges");
  assertEqual(crystal2?.spent, 1, "one of the crystal's 2 charges is spent");
  assertEqual(
    halfSpent.solved,
    false,
    "R8: solved stays false while a charge is unspent, even with every " +
      "channel's beam complete (specs/beams.md R9 reads R8)",
  );

  // Probe 2 — a beam left ending on the crystal: all charges spent, but the
  // crossing begun across it has not been completed.
  const board = await loadBoard(h, CRYSTAL_END);
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  const ending = await h.snapshot();
  assertDeepEqual(
    ending.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the beam is left ending on the crystal",
  );
  const crystal1 = ending.board.nodes.find(
    (node) => node.col === 1 && node.row === 0,
  );
  assertEqual(crystal1?.spent, 1, "the crystal's only charge is spent");
  assertEqual(
    ending.solved,
    false,
    "R8: a beam left ending on a crystal has begun a crossing it has not " +
      "completed and leaves the crystal unsatisfied, so solved stays false " +
      "(specs/beams.md)",
  );
  assertEqual(
    ending.screen,
    "playing",
    "an unsolved board stays on the playing screen",
  );

  // Evidence: the crystal holding the board unsolved.
  await h.advance(1);
  await captureStill(h, "unsatisfied");

  // Complete the crossing: resume from the beam's crystal end (a press on
  // either end of a beam resumes it there — specs/controls.md) and leave to
  // the far emitter.
  await pressAt(h, board, { col: 1, row: 0 });
  const resumed = await h.snapshot();
  assertDeepEqual(
    resumed.tracing,
    { channel: "triangle", live: { col: 1, row: 0 } },
    "the press on the beam's crystal end resumes the triangle trace",
  );
  await moveOver(h, board, { col: 2, row: 0 });
  const completed = await h.snapshot();
  await h.debug.pointerUp();

  assertEqual(
    completed.solved,
    true,
    "completing the crossing satisfies the crystal and flips solved true " +
      "(specs/beams.md R8, R9)",
  );
});
