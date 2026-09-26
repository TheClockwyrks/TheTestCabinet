// tape/ending-tick-runs-no-later-stage — the tick a run ends on runs none of the
// stages below the tape stage.
//
// `specs/program.md` § The tick pipeline, stage 1: "A tick that finds no live
// step and no step left to take is the tick the run ends on: cleared if every
// load is `placed`, otherwise failed as `loads-unplaced`. It runs none of the
// stages below." So on that tick no axis moves, no geometry is built, no
// pendulum steps, nothing is tested for a collision and nothing is solved.
//
// THE ARM IS STOOD SOMEWHERE ELSE BEFORE THE ENDING TICK, because a stage that
// did run is only visible through what it would have produced. `setAxis` "sets an
// axis's value, leaving it stopped with no live command" and poses a precondition
// rather than an outcome (`specs/instrumentation.md`), so standing the slew at
// forty-five degrees changes what stages 3 and 6 WOULD answer without reaching a
// verdict of its own. The minimal crane's trolley point stands `sqrt(2)` from the
// slew axis at `(1, ., 1)`, so turning the arm forty-five degrees carries the
// pivot about a unit away from where it stood: had the ending tick built its
// geometry, `run.pivot` would be there, and had it solved the turned arm,
// `run.forces` would be that solve's. Both must still read what the tick before
// left.
//
// THE ENDING TICK IS REACHED AS EARLY AS THE RULE ALLOWS. The tape is one move
// step commanding the hoist to the value it already holds, which is "done on the
// tick it is issued" (`specs/program.md` § Axis motion), so tick two is the tick
// that finds no live step and no step left. The yard is empty, so every load is
// placed vacuously and the run ends cleared — the reading is about what the
// ending tick did NOT do, and is the same whichever verdict it reached.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One step, done on the tick it is issued: tick 2 is the ending tick. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
  },
];

/** Where the arm is stood before the ending tick: a quarter of a right angle. */
const TURNED = 45;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the pivot and the solve of the tick before on the tick a run ends", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const before = await runTicks(h, 1);
  assertEqual(
    before.run.phase,
    "running",
    "the run at the end of tick 1, which took the tape's one step",
  );
  assertGreaterThan(
    before.run.forces.length,
    0,
    "the members tick 1's solve reported, so the reading below is a solve's " +
      "output rather than an empty list",
  );

  // Stand the arm somewhere else, so a geometry stage or a solve on the ending
  // tick would answer differently from the tick before.
  await h.debug.setAxis("slew", TURNED);
  const ended = await runTicks(h, 1);

  await h.capture("state", "The scene the tick a run ended on left");

  assertEqual(ended.run.tick, 2, "the tick the run ended on");
  assertEqual(
    ended.run.phase,
    "cleared",
    "the run a tape that runs out with every load placed reaches " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.run.axes.slew.value,
    TURNED,
    "the slew the ending tick stood at, so the geometry it would have built " +
      "is a turned one",
  );
  assertDeepEqual(
    ended.run.pivot,
    before.run.pivot,
    "run.pivot on the ending tick: it runs none of the stages below the tape " +
      "stage, so no geometry was built and the pivot is still the one the " +
      "tick before left (specs/program.md)",
  );
  assertDeepEqual(
    ended.run.forces,
    before.run.forces,
    "run.forces on the ending tick: no solve ran on it, so the forces are " +
      "still the tick before's (specs/program.md)",
  );
});
