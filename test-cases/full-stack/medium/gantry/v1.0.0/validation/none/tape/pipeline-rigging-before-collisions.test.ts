// tape/pipeline-rigging-before-collisions — a tick that snaps the cable and
// strikes an obstacle at once ends the run as `cable-snap`.
//
// `specs/program.md` § The tick pipeline numbers the stages — "4. Rigging: the
// pendulum tick, the cable tension, and the snap check … 5. Collisions: members,
// the load, and the ground" — and fixes what happens when a tick reaches two of
// them: "The first failure a tick reaches ends the run with that cause and the
// later stages of that tick do not run." So a tick that owes both verdicts owes
// the rigging one.
//
// BOTH CONDITIONS ARE POSED ONTO THE SAME TICK, and the tick is the run's first,
// because an obstacle cannot be added once a run is running (`specs/instrumentation.md`:
// the site poses apply "with no run in progress"), so a member already standing
// inside one strikes it on the very first tick. The snap therefore has to be
// arranged for that same first tick, and the tension there is a still one:
// "On a run's first tick the acceleration is zero, whatever velocity the steps
// above leave" (`specs/rigging.md`), so `T = m * (a - g)` is the hanging weight,
// `m * GRAVITY`. A load of mass `400` on the hook makes that
// `(400 + HOOK_MASS) * GRAVITY`, `4050`, past `HOIST_CABLE_CAP` (`3000`) — the
// snap comes from the specification's own tension formula rather than from a
// posed velocity the first tick would discard.
//
// The load is hung with `setLoadPhase`, which "hangs that load on the hook
// exactly as a successful `attach` leaves it, without the candidate search and
// without the `attach-missed` verdict".
//
// THE OBSTACLE ENCLOSES ONE MEMBER AND NOTHING ELSE: a unit box around the
// minimal crane's rail at `x = 1`, which no other member of that crane reaches
// and which stands four units above the load hanging under the tower. The tape
// is a single grip move, which turns the hook and moves neither the pivot nor
// the cable, so the tick under test is the one the scenario posed rather than one
// the tape steered into.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
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

/**
 * The load on the hook. `(400 + HOOK_MASS) * GRAVITY` is `4050`, past
 * `HOIST_CABLE_CAP` (`3000`), on a tick whose bob acceleration is zero.
 */
const MASS = 400;

/** Where it waits before it is hung: clear of the crane and of the obstacle. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 };
const TO = { x: 0, y: 2, z: 8, yaw: 0 };

/** A unit box around the rail at `x = 1`, and around nothing else. */
const OBSTACLE_MIN = { x: 0.5, y: 3.5, z: -0.5 };
const OBSTACLE_SIZE = { x: 1, y: 1, z: 1 };

/** A tape that keeps the run going and moves neither the pivot nor the cable. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 90, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the cable snap, not the obstacle, on the tick that owes both", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", MASS, FROM, TO);
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseTape(h, TAPE);
  await startRun(h);

  await h.debug.setLoadPhase(0, "attached");
  const struck = await runTicks(h, 1);

  await h.capture("state", "The run the first tick ended");

  assertEqual(
    struck.run.phase,
    "failed",
    "the phase after a tick whose cable tension is past HOIST_CABLE_CAP and " +
      "whose rail stands inside an obstacle (specs/program.md)",
  );
  assertEqual(
    struck.run.cause,
    "cable-snap",
    "the cause that tick carries: rigging is stage 4 and collisions stage 5, " +
      "and the first failure a tick reaches ends the run (specs/program.md)",
  );
});
