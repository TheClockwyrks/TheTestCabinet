// Facet — instrumentation/clear-refill-kinds-clears-every-column:
// `clearRefillKinds` leaves no refill posed on any column.
//
// WHAT THE SPECIFICATION ASKS FOR. specs/instrumentation.md, of
// `clearRefillKinds()`: "Leaves no refill posed on any column, so every refill
// draws as R9 states. Nothing else changes." A scenario that posed a refill for
// one step and wants the next one drawn is what the operation serves, and a
// build whose clear left a column posed would deal that pose into every later
// step of every scenario that followed.
//
// HOW IT IS READ. Two columns are posed with two different strings, the clear is
// called, and `refillKinds` is read back against its resting value: `GRID_COLS`
// entries, every one `""`. Two columns rather than one, so a build that cleared
// only the column most recently posed is caught. Whether a column really DRAWS
// again is not decidable from one deal, and the specification states the draw as
// a distribution rather than a value, so the reading is the pose's absence.
//
// WHAT IS DELIBERATELY LEFT UNASSERTED. What a pose deals and how it is
// reported are `instrumentation/set-refill-kinds-deals-the-pose` and
// `instrumentation/set-refill-kinds-reported`; that a `reset` clears the pose
// as well is `instrumentation/reset-restores-every-field`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { assertBoardEquals, quietBoard, renderBoard } from "../board";
import { RESTING_REFILL_KINDS } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  type Harness,
} from "../harness";

/** Two columns posed with two different strings, so the clear has two to undo. */
const POSES: readonly (readonly [col: number, kinds: string])[] = [
  [1, "SM"],
  [5, "C"],
];

let h: Harness;

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns every column to drawing, and changes nothing else", async () => {
  requireSurface();
  const before = await loadBoard(h, quietBoard());

  for (const [col, kinds] of POSES) await h.debug.setRefillKinds(col, kinds);
  // The poses really stand before the clear is asked to undo them; without this
  // the reading below could be taken off a build whose poses never took.
  for (const [col, kinds] of POSES) {
    assertEqual(
      (await h.snapshot()).refillKinds[col],
      kinds,
      `the pose standing on column ${col}`,
    );
  }

  await h.debug.clearRefillKinds();
  const s = await h.snapshot();
  assertDeepEqual(
    s.refillKinds,
    RESTING_REFILL_KINDS,
    "refillKinds after clearRefillKinds",
  );

  // "Nothing else changes."
  assertBoardEquals(
    renderBoard(s),
    renderBoard(before),
    "the board after clearing the refill",
  );
  assertEqual(s.screen, before.screen, "the screen after clearing the refill");
  assertEqual(s.phase, before.phase, "the phase after clearing the refill");

  await h.advance(1);
  await captureStill(h, "cleared");
});
