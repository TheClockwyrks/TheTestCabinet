// Refract — ruleset/r9-solved: R9 Solved.
//
// specs/beams.md R9: "A board is solved when R6 and R7 hold for every channel
// present and R8 holds for every crystal on the board", evaluated after every
// change; and specs/controls.md, Releasing: "A trace also ends the moment the
// board is solved" — the game leaves `playing` on the solving move itself
// (specs/instrumentation.md: a move that satisfies R9 solves the board on the
// spot). R9_UNIQUE's solution is essentially unique —
// T(0,0)-t(0,1)-t(1,1)-t(2,1)-T(3,2) — so the route is a known solution: one
// move before its end the board reads unsolved, and the final permitted move
// flips solved true and leaves `playing` at that same call, with no frame
// advanced in between.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  toCells,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("solved flips true on the final permitted move, which leaves playing", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R9_UNIQUE);

  // Everything but the final move of the known solution.
  const solution: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 2],
  ];
  pressCell(h, { col: 0, row: 0 });
  for (const [col, row] of solution.slice(1, -1)) moveToCell(h, { col, row });

  // One segment short: every cell but the last is drawn, and the board reads
  // unsolved — R6 does not yet hold of the one channel present.
  const before = h.snapshot();
  assertDeepEqual(
    before.beams.triangle?.cells,
    toCells(solution.slice(0, -1)),
    "the route stands one segment short of the solution",
  );
  assertEqual(before.solved, false, "one segment short, the board is unsolved");
  assertEqual(before.screen, "playing", "the unsolved board is still playing");

  // The final permitted move: solved flips true and the game leaves playing
  // on that same call — nothing is advanced between the move and the read.
  moveToCell(h, { col: 3, row: 2 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    toCells(solution),
    "the final move lands the solution's last segment",
  );
  assertEqual(after.solved, true, "solved flips true on the final move");
  assertNotEqual(
    after.screen,
    "playing",
    "the game leaves playing on that same call",
  );

  // Evidence: the board on its solving move.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "solved");
});
