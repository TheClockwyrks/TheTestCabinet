// instrumentation/set-pose-cell — `setPoseCell` moves a mounted part's LIVE base
// cell, and `advance` and `recede` carry on from there.
//
// THE RULE. "`setPoseCell(part, q, r)` | Sets that part's live base cell, which is
// a cell of the track it is mounted on, the same way."
// (`specs/instrumentation.md`, The run) — "the same way" being
// `setPoseRotation`'s: the live pose moves and the rest pose in `editor.parts`
// stands. It is the gate the same file names for a part's live pose, "which move
// it with no tape running". What then carries on from it: "The `advance`
// instruction carries a mounted arm's base to the next cell of the path and
// `recede` to the previous one" (`specs/parts.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run carrying a five-cell open track
// from `(-2, 0)` to `(2, 0)` and one piston mounted on its FIRST cell, whose tape
// is `advance`, `recede`. The field is emptied, so the piston carries nothing and
// no mote can collide with anything. The base cell is posed to `(0, 0)`, the
// middle of the path — two cells along from where the run started the piston, and
// with a cell to spare at each end, so neither `advance` nor `recede` can reach
// the end of an open track and fault.
//
// THE VERDICT. `sim.poses` reports the piston's base cell as the posed `(0, 0)`
// while `editor.parts` still reports its anchor `(-2, 0)`. Then cycle `0` runs
// `advance` and leaves it on `(1, 0)` — the cell after the POSED one, where a
// build that had ignored the pose would be on `(-1, 0)` — and cycle `1` runs
// `recede` and brings it back to `(0, 0)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partById,
  partIds,
  pauseRun,
  poseOf,
  posePart,
  resumeRun,
  type Harness,
} from "../harness";

/** The track's five cells, and the cell the base is posed onto. */
const PATH = [at(-2, 0), at(-1, 0), at(0, 0), at(1, 0), at(2, 0)];
const POSED_CELL = at(0, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the live base cell, leaves the anchor, and advances and recedes from it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart(PATH),
      armPart("piston", -2, 0, 0, 1, ["advance", "recede"]),
    ]),
  });
  const piston = (await partIds(h))[1] ?? -1;
  const before = await h.snapshot();

  await posePart(h, piston, { cell: POSED_CELL });
  const posed = await h.snapshot();

  await pauseRun(h);
  await h.advance(1);
  await captureStill(h, "posed");
  await resumeRun(h);

  await advanceCycles(h, 1);
  const advanced = await h.snapshot();
  await advanceCycles(h, 1);
  const receded = await h.snapshot();

  assertNotNull(before.sim, "the run is live before the pose");
  assertEqual(
    `${poseOf(before, piston)?.cell.q},${poseOf(before, piston)?.cell.r}`,
    "-2,0",
    "the run started the piston on its anchor, so the pose has somewhere to move it from",
  );
  assertEqual(
    `${poseOf(posed, piston)?.cell.q},${poseOf(posed, piston)?.cell.r}`,
    `${POSED_CELL.q},${POSED_CELL.r}`,
    "setPoseCell sets the part's live base cell in sim.poses",
  );
  assertEqual(
    `${partById(posed, piston)?.q},${partById(posed, piston)?.r}`,
    "-2,0",
    "its anchor in editor.parts stands: a rest pose and a live pose are separate",
  );
  assertNull(
    advanced.sim?.fault ?? null,
    "advance from the posed cell reaches the next cell of the path rather than the end of the track",
  );
  assertEqual(
    `${poseOf(advanced, piston)?.cell.q},${poseOf(advanced, piston)?.cell.r}`,
    "1,0",
    "advance carried the base to the cell after the posed one, not after the anchor",
  );
  assertEqual(
    `${poseOf(receded, piston)?.cell.q},${poseOf(receded, piston)?.cell.r}`,
    `${POSED_CELL.q},${POSED_CELL.r}`,
    "recede carried it back to the previous cell, which is the posed one",
  );
});
