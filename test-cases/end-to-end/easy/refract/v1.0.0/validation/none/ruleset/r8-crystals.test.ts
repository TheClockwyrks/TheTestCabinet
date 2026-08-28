// ruleset/r8-crystals — R8: a crystal is satisfied when all of its charges
// are spent AND every crossing begun across it has been completed; a beam
// that ends on a crystal has begun a crossing it has not completed, and
// leaves that crystal unsatisfied (specs/beams.md).
//
// THE POSE. `SHARED_CRYSTAL`:
//
//   T2T
//   S.S
//
// The triangle beam crosses the 2-charge crystal completely and is complete.
// The square beam then enters the crystal and is RELEASED there. At that
// moment every charge is spent (`spent` 2 of 2) — the reading that would
// satisfy a build that only counts charges — yet the begun, uncompleted
// crossing must hold `solved` false. Resuming the square beam from its
// crystal end and leaving to the far emitter completes the crossing, and
// `solved` flips true on that move.
//
// ONE WORD ON THE MANIFEST'S "even while every channel's beam reports
// complete": a beam that ends on a crystal is by R6 not complete itself, so
// no arrangement can make literally every channel's beam complete while a
// crossing stands begun-and-not-left. What the pose holds complete is every
// OTHER channel's beam — the triangle's — which is asserted, so the refusal
// to solve is attributable to the crystal rather than to some unfinished
// beam elsewhere.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { SHARED_CRYSTAL } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("a beam left ending on a crystal holds solved false, and completing the crossing flips it true", async () => {
  const board = await loadBoard(h, SHARED_CRYSTAL);

  // The triangle beam crosses the crystal completely: one charge spent, its
  // crossing completed, the beam complete.
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
  ]);

  // The square beam enters the crystal and is left there.
  await traceCells(h, [
    { col: 0, row: 1 },
    { col: 1, row: 0 },
  ]);

  const pending = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "unsatisfied");

  const crystal = pending.board.nodes.find((node) => node.kind === "crystal");
  assertEqual(crystal?.charges, 2, "the crystal carries two charges");
  assertEqual(crystal?.spent, 2, "every charge is spent on entry");
  assertEqual(
    pending.beams.triangle?.complete,
    true,
    "the other channel's beam reports complete",
  );
  assertEqual(
    pending.solved,
    false,
    "the begun, uncompleted crossing leaves the board unsolved",
  );
  assertEqual(
    pending.screen,
    "playing",
    "an unsolved board stays on the playing screen",
  );

  // Complete the crossing: resume the square beam from its crystal end (a
  // press on either end of a beam resumes it there — specs/controls.md) and
  // leave to the far emitter.
  await pressAt(h, board, { col: 1, row: 0 });
  const resumed = await h.snapshot();
  assertDeepEqual(
    resumed.tracing,
    { channel: "square", live: { col: 1, row: 0 } },
    "the press on the beam's crystal end resumes the square trace",
  );
  await moveOver(h, board, { col: 2, row: 1 });
  const completed = await h.snapshot();
  await h.debug.pointerUp();

  assertEqual(
    completed.solved,
    true,
    "completing the crossing satisfies the crystal and flips solved true",
  );
});
