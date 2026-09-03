// tape/two-actions-occupy-two-ticks — two actions in a row occupy two ticks.
//
// `specs/program.md` § The tick pipeline: "An action step is taken, executed and
// complete on one tick, and the step after it is taken on the next, so two
// actions in a row occupy two ticks and never one." A tick takes at most one step
// from the tape, so the tick that attaches cannot also release.
//
// THE TWO ACTIONS BOTH SUCCEED, so the reading is about WHEN each ran rather than
// about either being refused. The load is lifted from the hook's own point and
// wanted back on it, which passes all three of `specs/rigging.md`'s release
// tests: the pivot never moves, so the bob hangs dead still and its speed is
// zero; the lift point is the bob's position, which is the pad; and `attach`
// "set[s] the grip's axis value to the load's current yaw", which is the yaw the
// pad asks for. A build that ran both actions on one tick would report the load
// `placed` on the tick it was taken up.
//
// THE HOIST IS PAID IN so the crate hangs a unit clear of the ground rather than
// flush against it, which keeps `specs/statics.md`'s ground test out of a reading
// that is about the tape.
//
// AND IT IS POSED RATHER THAN DRIVEN. `setAxis` "sets an axis's value, leaving it
// stopped with no live command" and `setBob` "puts the bob where it is asked for"
// (`specs/instrumentation.md`), so the cable stands paid in at the top of the
// run's first tick, and the tape's opening move — to the value the hoist now
// holds — "is done on the tick it is issued" (`specs/program.md` § Axis motion).
// Driving that move instead costs twenty-six ticks of a hoist controller this
// point does not decide, and a build whose controller was slow or wrong would
// fail here as well as in the items that are about it. The pose is a precondition
// and nothing more: the attach and the release are still executed by the tape, on
// the ticks the run gives them, and the ticks they land on are the whole reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  addOneLoad,
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

/** Where the hook hangs once the hoist is in: the minimal crane's pivot, less L. */
const HOOK = { x: 0, y: 4 - HOIST_MIN, z: 0, yaw: 0 };

/** Pay the cable in, then the two actions, back to back. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
  { kind: "action", action: "release" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("executes an attach and the release after it on two consecutive ticks", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);

  // The cable paid in, and the bob where a cable of that length holds it: the
  // precondition the tape's opening move would otherwise spend twenty-six ticks
  // reaching. The run has not ticked yet, so the move is issued against a hoist
  // already at its target and is complete on the tick that issues it.
  await h.debug.setAxis("hoist", HOIST_MIN);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const paidIn = await runTicks(h, 1);
  assertEqual(
    paidIn.run.axes.hoist.value,
    HOIST_MIN,
    "the hoist on the tick that issued the opening move: the pose put it at " +
      "the move's own target, so the command has `s` of `0` and is done on " +
      "the tick it is issued (specs/program.md § Axis motion)",
  );
  const attached = await runTicks(h, 1);
  const released = await runTicks(h, 1);

  await h.capture("state", "The tick after the attach, which ran the release");

  assertEqual(
    attached.run.loads[0]?.phase,
    "attached",
    "the load's phase on the tick the attach ran: the release after it has " +
      "not run, so the load is on the hook and not on its pad " +
      "(specs/program.md)",
  );
  assertEqual(
    attached.run.stepIndex,
    2,
    "run.stepIndex on the attach's own tick: an action step is taken, " +
      "executed and complete on one tick (specs/program.md)",
  );
  assertEqual(
    released.run.tick,
    attached.run.tick + 1,
    "the tick the release ran on: the step after an action is taken on the " +
      "next tick, so two actions in a row occupy two ticks (specs/program.md)",
  );
  assertEqual(
    released.run.loads[0]?.phase,
    "placed",
    "the load's phase on the tick after the attach, which ran the release",
  );
});
