// rigging/bob-starts-below-the-pivot — a run begins with the bob hanging at rest
// straight under the pivot, at the cable's length.
//
// `specs/rigging.md` § The pivot and the bob: "At the start of a run the bob
// hangs at rest directly below the pivot: position the pivot minus `(0, L, 0)`,
// velocity zero." `L` is the hoist axis's value, so the reading below takes the
// pivot and the length the build itself reports at the start and asks only that
// the bob stand where those two put it — a build whose run-start hoist value is
// wrong fails that requirement in `specs/program.md` rather than this one.
//
// THE READING IS TAKEN BEFORE A TICK RUNS. `specs/state.md` numbers the run's
// first tick `1` and says a start "takes no tick of its own", so the snapshot
// `startRun` answers with is the run at tick `0`: exactly the moment this
// requirement speaks of, and before the pendulum has had a chance to move
// anything.
//
// THE WORLD HOLDS THE CRANE AND NOTHING ELSE. The loads and the obstacles are
// cleared and the crane is the minimal one, so nothing in the yard can end the
// run or move the pivot before the reading; the tape is one grip move, which
// "applies no force to anything" (`specs/rigging.md`) and is there only because
// an empty tape refuses the start (`specs/program.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertVec3Near } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A tape that keeps a run legal and asks nothing of the rigging. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Arithmetic slack on a position the specification fixes exactly. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hangs the bob at rest the hoist length below the pivot at a run's start", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);

  const { run } = await startRun(h);

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertVec3Near(
    run.bob.pos,
    {
      x: run.pivot.x,
      y: run.pivot.y - run.axes.hoist.value,
      z: run.pivot.z,
    },
    TOLERANCE,
    `the bob at the run's start: the pivot minus (0, L, 0) with L the hoist ` +
      `axis's value ${run.axes.hoist.value} (specs/rigging.md)`,
  );
  assertVec3Near(
    run.bob.vel,
    { x: 0, y: 0, z: 0 },
    TOLERANCE,
    "the bob's velocity at the run's start, which is zero (specs/rigging.md)",
  );
});
