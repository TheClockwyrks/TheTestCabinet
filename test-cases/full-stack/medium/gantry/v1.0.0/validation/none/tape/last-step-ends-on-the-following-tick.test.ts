// tape/last-step-ends-on-the-following-tick — a final action step's own tick runs
// in full, and the tick after it is the one that ends the run.
//
// `specs/program.md` § The tick pipeline: "The tape's last step is no different:
// the run ends at the top of the first tick that finds it complete and no step
// left to take, so a final action step's own tick runs in full and the tick after
// it is the one that ends the run." The verdict does not arrive early: the tick
// that placed the last load goes on to its motion, its geometry, its rigging, its
// collisions, its solves and its readouts, and only the tick after it reads the
// tape out.
//
// THE LAST STEP IS THE RELEASE THAT PLACES THE ONLY LOAD, which is the case the
// requirement is written for: the run has nothing left to do the moment that step
// executes, so a build that ended the run on the same tick would look right on
// every reading but these.
//
// THE TICK IS SHOWN TO HAVE RUN IN FULL BY THE SOLVE IT REPORTS. `specs/rigging.md`
// fixes the mass the cable carries across a release: "The bob's mass drops back
// to the hook's from this tick's pendulum step on", and `specs/statics.md` applies
// that cable force to the structure at the trolley point. The load is `40` and the
// hook is `HOOK_MASS` (`5`), so the tick that lets the load go pulls on the crane
// with some four hundred force units less than the tick that took it up, and the
// forces the release tick reports are its own rather than the attach tick's.
//
// THE POSE IS AN ORDINARY LIFT. The hoist is paid out to `HOIST_MIN` first so the
// hook stands a unit clear of where the crate's underside would reach, and the
// load's pad is the pose it is lifted from, so the release passes all three of
// `specs/rigging.md`'s tests — the bob hangs dead still under a pivot nothing
// moves, so its speed is zero, and `attach` "set[s] the grip's axis value to the
// load's current yaw", which is the yaw the pad asks for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where the hook hangs once the hoist is in: the minimal crane's pivot, less L. */
const HOOK = { x: 0, y: 4 - HOIST_MIN, z: 0, yaw: 0 };

/** The load: lifted from the hook's own point, and wanted back on it. */
const LOAD_MASS = 40;

/** Pay the cable in, take the load, and set it down: the release is the last step. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
  { kind: "action", action: "release" },
];

/** Ticks the sweep is given: paying in one unit takes about twenty-six. */
const CAP = 300;

/**
 * How much the summed member force must move between the two ticks. Letting a
 * `40` load go takes some `400` force units off the cable, so a fiftieth of that
 * is comfortably above float noise and far below the change itself.
 */
const FORCE_MOVED = 50;

/** The summed magnitude of every member force a solve reported. */
function totalForce(s: GantrySnapshot): number {
  return s.run.forces.reduce((sum, one) => sum + Math.abs(one.force), 0);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs the last step's own tick in full and ends the run on the tick after", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);

  const attached = await runUntil(
    h,
    (s) => s.run.loads[0]?.phase === "attached",
    CAP,
    "the tape's attach step to take the load up",
  );
  const released = await runTicks(h, 1);
  const next = await runTicks(h, 1);

  await h.capture("state", "The tick after the tape's last step");

  assertEqual(
    released.run.loads[0]?.phase,
    "placed",
    "the load's phase on the tick the tape's last step ran: the release " +
      "judged it onto its pad (specs/rigging.md)",
  );
  assertEqual(
    released.run.phase,
    "running",
    "the run at the end of the tick the last step executed on: that tick runs " +
      "in full and does not end the run (specs/program.md)",
  );
  assertGreaterThan(
    Math.abs(totalForce(released) - totalForce(attached)),
    FORCE_MOVED,
    "how far the summed member force moved between the tick that took the " +
      "load up and the tick that let it go, so the release tick's readouts " +
      "are its own solve's rather than the tick before's (specs/program.md)",
  );

  assertEqual(
    next.run.tick,
    released.run.tick + 1,
    "the tick after the tape's last step",
  );
  assertEqual(
    next.run.phase,
    "cleared",
    "the run on the tick after the last step: that tick is the first to find " +
      "the step complete and no step left, and every load is placed " +
      "(specs/program.md)",
  );
});
