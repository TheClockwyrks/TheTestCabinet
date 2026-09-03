// instrumentation/run-pose-reaches-no-verdict — a run pose reaches no verdict of its
// own.
//
// `specs/instrumentation.md` § The run in progress: "Each sets what it names and
// leaves the rest of the run as it stands, and none of them reaches a verdict: the
// run's own rules decide clearing, breakage, and every failure on the ticks that
// follow." The guardrail the whole surface rests on: a pose "establishes a
// precondition and never an outcome".
//
// PUTTING THE ONLY LOAD IN THE `placed` PHASE IS THE SHARPEST CASE OF IT, because
// clearing is exactly one tick away. `specs/program.md` puts the decision in the tape
// stage: "A tick that finds no live step and no step left to take is the tick the run
// ends on: cleared if every load is `placed`". So after this pose the run satisfies
// everything a clear needs and is still `running` — the verdict is the tape stage's
// to reach, on a later tick, and a build whose `setLoadPhase` concluded the run for
// itself reads `cleared` at the call.
//
// THE READING IS TAKEN WITH NOTHING ADVANCED, so the only thing that could have
// ended the run is the pose. Then the run is driven, and the verdict that arrives is
// the one the rules owed: `cleared`, once the tape runs out.
//
// One load, one short hoist step, and the harness's minimal crane: the crane and the
// tape are not what this decides, and are only here because a run has to start.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** Where the one load stands, and the pad it is wanted on. */
const POSE = { x: 8, y: 2, z: 0, yaw: 0 } as const;

/** Well past the hoist step: a move of one unit takes under a second. */
const CAP = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the run running at the call and lets the rules reach the verdict", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, POSE, POSE);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);
  await runTicks(h, 5);

  // The precondition a clear needs, established without a tick being taken.
  await h.debug.setLoadPhase(0, "placed");
  const posed = await h.snapshot();
  await h.capture("state", "the run at the call, with every load placed");

  assertEqual(
    posed.run.loads[0]?.phase,
    "placed",
    "the phase the pose set",
  );
  assertEqual(
    posed.run.phase,
    "running",
    "the run at the call: a pose establishes a precondition and never an " +
      "outcome (specs/instrumentation.md)",
  );
  assertNull(posed.run.cause, "the cause at the call");

  // And the verdict the rules owe, on the ticks that follow.
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the run to reach a verdict of its own once the tape runs out",
  );
  assertEqual(
    ended.run.phase,
    "cleared",
    "the verdict the tape stage reaches on the tick that finds no step left " +
      "and every load placed (specs/program.md)",
  );
});
