// rigging/grip-turns-the-attached-load — a carried load's yaw IS the grip's value.
//
// specs/rigging.md § The grip: "The grip is the powered swivel in the hook, and
// its axis value is the hook's yaw in degrees. With a load attached, the load's
// yaw is the grip's value: the grip turns the load, kinematically, about the
// vertical line through the bob." Kinematically — the load does not lag the grip,
// chase it, or ease into it: on every tick the two are one number, which is what
// lets a tape put a container down at `90` by driving one axis to `90`.
//
// SO THE READING IS TAKEN ON EVERY TICK OF THE TURN, not just at the end of it. A
// build that turned the load only when the grip stopped, or eased it toward the
// grip over a few ticks, matches at the end and never matches in the middle. The
// grip is driven from the run's starting `0` (specs/program.md § The axes) to
// `GRIP_TARGET` (`90`), which under `GRIP_MAX_RATE` and `GRIP_ACCEL` accelerates
// for half a second, cruises, and brakes for half a second — a hundred and fifty
// ticks of turning, each one compared.
//
// THE LOAD IS HUNG THROUGH THE SURFACE, so nothing in the candidate rules stands
// between the scenario and the grip. specs/instrumentation.md: `setLoadPhase` to
// `"attached"` "hangs that load on the hook exactly as a successful `attach`
// leaves it, without the candidate search and without the `attach-missed`
// verdict", and it leaves the grip's value alone — which is what makes the run's
// `0` the honest starting point for a turn to `90`.
//
// The crane stands on an emptied yard with one load, so the only obstacle and the
// only ground in play are the ones specs/statics.md § Collisions names: a crate
// hanging with its lift point at `y = 2` has its bottom face exactly on `y = 0`,
// which "is on the ground, not through it", and turning it about the vertical
// moves neither face.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { GRIP_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
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
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the bob hangs at the run's start: the pivot minus `(0, L, 0)`. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The quarter turn the grip is driven through. */
const GRIP_TARGET = 90;

/** Ticks the turn is allowed; at GRIP_MAX_RATE it takes some 150. */
const CAP = 300;

/** A yaw the grip carries by assignment; the tolerance is arithmetic noise. */
const TOLERANCE = 1e-9;

/** A move whose target is the axis's value: one tick, and nothing moves. */
const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

/** The turn under test. */
const TURN: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: GRIP_TARGET, rate: GRIP_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the carried load's yaw at the grip's value on every tick", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { ...HOOK, yaw: 0 },
    { x: 6, y: 2, z: 0, yaw: GRIP_TARGET },
  );
  await poseTape(h, [NOOP, TURN]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setLoadPhase(0, "attached");

  const hung = await h.snapshot();
  assertEqual(
    hung.run.attached,
    0,
    "the load hung on the hook before the turn begins",
  );

  let sampled = 0;
  const turned = await runUntil(
    h,
    (s) => {
      if (s.run.tick >= 2) {
        sampled += 1;
        assertEqual(
          s.run.loads[0]?.phase,
          "attached",
          `the load's phase on tick ${s.run.tick}, while the grip turns`,
        );
        assertNear(
          s.run.loads[0]?.yaw as number,
          s.run.axes.grip.value,
          TOLERANCE,
          `the carried load's yaw on tick ${s.run.tick}, against the grip's ` +
            `own value of ${s.run.axes.grip.value.toFixed(4)}: "with a load ` +
            "attached, the load's yaw is the grip's value\" " +
            "(specs/rigging.md § The grip)",
        );
      }
      return s.run.axes.grip.value >= GRIP_TARGET - TOLERANCE;
    },
    CAP,
    `the grip to reach ${GRIP_TARGET}`,
  );
  await h.capture(
    "state",
    `a carried load turned to ${GRIP_TARGET} by the grip`,
  );

  assertGreaterThan(
    sampled,
    60,
    `the ticks the grip took to reach ${GRIP_TARGET}, so the load's yaw was ` +
      "read while the grip was accelerating, cruising and braking",
  );
  assertEqual(
    turned.run.axes.grip.value,
    GRIP_TARGET,
    "the grip at the end of its move (specs/program.md § Axis motion)",
  );
  assertNear(
    turned.run.loads[0]?.yaw as number,
    GRIP_TARGET,
    TOLERANCE,
    `the carried load's yaw once the grip arrived at ${GRIP_TARGET} ` +
      "(specs/rigging.md § The grip)",
  );
});
