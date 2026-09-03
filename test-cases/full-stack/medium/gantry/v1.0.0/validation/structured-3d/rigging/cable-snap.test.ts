// rigging/cable-snap — a tension past the cap snaps the cable and ends the run.
//
// specs/rigging.md § Cable tension and snapping states it in one sentence: "A
// tick on which `|T|` exceeds `HOIST_CABLE_CAP` (`3000`) snaps the cable and ends
// the run as `cable-snap`, whether or not a load is attached."
//
// THE TENSION IS READ OFF THE SAME SECTION'S FORMULA, at the one posture where it
// is exact. `T = m * (a - g)`, so a bob hanging at rest below a still pivot — `a`
// zero — carries `m * GRAVITY` straight up the cable and nothing else. A bob of
// `BOB_MASS` (`330`) is therefore a tension of `3300`, a tenth past the cap, with
// no swing, no hoisting and no slewing in the reading. The hook is `HOOK_MASS`
// (`5`) of that, so the load hung on it is `325`.
//
// THE LOAD IS HUNG THROUGH THE SURFACE RATHER THAN THROUGH AN `attach` STEP.
// specs/instrumentation.md: `setLoadPhase` to `"attached"` "hangs that load on the
// hook exactly as a successful `attach` leaves it, without the candidate search
// and without the `attach-missed` verdict", so the scenario reaches the tension
// this point is about without any part of the candidate rules standing in the way.
//
// WHY THE STRUCTURE UNDER IT NEVER GETS A SAY. The snap is stage 4 of the tick
// pipeline specs/program.md fixes and the solves are stage 6, and "the first
// failure a tick reaches ends the run with that cause and the later stages of that
// tick do not run" — so a crane that could not have carried `3300` cannot reach a
// verdict of its own first.
//
// The tape is one long `grip` move, which is the only axis whose motion moves
// neither the pivot nor the cable: "Turning the grip applies no force to
// anything." It is there to keep the run running, and it leaves the bob at rest.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  GRAVITY,
  GRIP_MAX_RATE,
  HOIST_CABLE_CAP,
  HOIST_START,
  HOOK_MASS,
} from "../constants";
import {
  addOneLoad,
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

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the bob hangs at the run's start: the pivot minus `(0, L, 0)`. */
const HOOK_AT = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** A bob a tenth past the cap: `3300` of tension hanging at rest. */
const BOB_MASS = HOIST_CABLE_CAP / GRAVITY + 30;

/** What is hung on the hook to make the bob weigh that much. */
const LOAD_MASS = BOB_MASS - HOOK_MASS;

/** A move that keeps the run running and moves neither pivot nor cable. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as cable-snap on the tick the tension passes the cap", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK_AT, HOOK_AT);
  await poseTape(h, [HOLD]);

  await startRun(h);
  // Two ticks of the bare hook first, so the tick under test is neither the
  // run's first — "On a run's first tick the acceleration is zero" — nor the one
  // the load arrives on.
  const bare = await runTicks(h, 2);
  assertEqual(
    bare.run.phase,
    "running",
    `the run with the bare hook on it, whose tension is ${HOOK_MASS * GRAVITY}`,
  );

  await h.debug.setLoadPhase(0, "attached");
  const snapped = await runTicks(h, 1);
  await h.capture(
    "state",
    `a bob of ${BOB_MASS} hanging at rest, ${BOB_MASS * GRAVITY} of tension`,
  );

  assertEqual(
    snapped.run.phase,
    "failed",
    `the run on the tick a bob of ${BOB_MASS} hangs at rest from the cable, ` +
      `whose tension is ${BOB_MASS * GRAVITY} against a cap of ` +
      `${HOIST_CABLE_CAP} (specs/rigging.md § Cable tension and snapping)`,
  );
  assertEqual(
    snapped.run.cause,
    "cable-snap",
    "the cause a tension past HOIST_CABLE_CAP ends the run with " +
      "(specs/rigging.md § Cable tension and snapping)",
  );
});
