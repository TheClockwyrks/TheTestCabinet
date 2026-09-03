// collisions/obstacle-test-is-strictly-inside — a body meets an obstacle only
// where it lies STRICTLY between the box's minimum and its maximum on all three
// axes.
//
// `specs/world.md` § Obstacles states the rule the whole game runs on: "An
// obstacle blocks only where something reaches inside it: a body meets an obstacle
// when some point of the body lies inside the box, STRICTLY BETWEEN THE BOX'S
// MINIMUM AND ITS MAXIMUM ON ALL THREE AXES." `specs/statics.md` § Collisions
// spends it during a run: "A member whose segment reaches inside an obstacle ends
// the run as `structure-struck-obstacle`", and "a member lying flush along an
// obstacle's face ... is clear of it".
//
// STRICTLY is the whole of this point, so it is decided by moving the BOX and
// nothing else. The crane is the same crane in both runs, the member is the same
// member, the tape is the same tape, and the two runs differ only in where the
// obstacle stands:
//
//   - `x 0..0.5`: the mast from `(0, 4, 0)` to `(0, 8, 0)` runs at `x = 0`, the
//     box's own minimum on that axis, for its whole length. Its `y` sweeps through
//     the box's `5..6` and its `z` sits inside the box's `-0.5..0.5`, so a build
//     testing two axes, or testing "at or inside" on the third, reads it as
//     struck. Strictly between says it is clear, and the run runs on.
//   - `x -0.25..0.25`: the same `y` and the same `z`, and now `x = 0` stands
//     strictly between `-0.25` and `0.25`. The member is inside on all three axes
//     and the run ends.
//
// THE BOX IS SMALL AND HIGH SO THAT ONE MEMBER DECIDES IT. Between `y 5` and
// `y 6` the minimal crane carries five members, and the four that are not the mast
// stand at `x 1..1.5` or at `z 1..1.5` there — outside both boxes on `x` or on `z`
// whichever way the box is moved. Everything else in the crane stands at `y <= 4`
// or at `y >= 7`. So the mast is the only body either box can touch.
//
// AND THE OBSTACLE IS PLACED AFTER THE CRANE IS BUILT, on purpose: the editor's
// own reading of this rule is a different point, and a run has to catch a member
// that was placed before the obstacle existed just the same.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The box `x 0..0.5`, `y 5..6`, `z -0.5..0.5`: the mast lies on its minimum. */
const FLUSH_MIN = { x: 0, y: 5, z: -0.5 };

/** The box `x -0.25..0.25`, `y 5..6`, `z -0.5..0.5`: the mast stands inside. */
const INSIDE_MIN = { x: -0.25, y: 5, z: -0.5 };

/** Both boxes are the same size; only the minimum corner moves. */
const SIZE = { x: 0.5, y: 1, z: 1 };

/** The slowest legal turn of the grip: it holds the run open and moves nothing. */
const HOLD_RATE = 0.001;
const HOLD_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 360, rate: HOLD_RATE }] },
];

/** Two seconds of run clock with the member lying on the box's minimum plane. */
const TICKS = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears a member on the box's minimum plane and strikes the same member inside it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);

  // ---- the member lying exactly on the box's minimum plane -----------------
  await addOneObstacle(h, FLUSH_MIN, SIZE);
  await startRun(h);
  const flush = await runTicks(h, TICKS);

  await h.capture("flush", "The member on the box's minimum plane");

  assertEqual(
    flush.run.phase,
    "running",
    `the run after ${TICKS} ticks with the mast at x 0 lying on the minimum x ` +
      "plane of the box x 0..0.5, y 5..6, z -0.5..0.5: no point of it is " +
      "strictly between the box's minimum and its maximum on all three axes " +
      "(specs/world.md)",
  );
  assertNull(flush.run.cause, "the cause of a run nothing reached inside");

  // ---- the same member, the same crane, the box moved a quarter unit --------
  await h.debug.abortRun();
  await addOneObstacle(h, INSIDE_MIN, SIZE);
  await startRun(h);
  const inside = await runTicks(h, 1);

  await h.capture("inside", "The member strictly inside the box");

  assertEqual(
    inside.run.phase,
    "failed",
    "the run on its first collision stage with the mast at x 0 standing " +
      "strictly inside the box x -0.25..0.25, y 5..6, z -0.5..0.5 on all " +
      "three axes (specs/world.md)",
  );
  assertEqual(
    inside.run.cause,
    "structure-struck-obstacle",
    "the cause a member reaching inside an obstacle ends the run with " +
      "(specs/statics.md)",
  );
});
