// rigging/grip-applies-no-force — turning the grip applies no force to anything.
//
// specs/rigging.md § The grip says it in four words: "Turning the grip applies no
// force to anything." The grip is a powered swivel in the hook and nothing else —
// it is not an arm node with a radius, it has no mass in specs/statics.md § The
// load model, and no term of the cable tension reads it. So a run in which the
// grip is the only thing moving is, to the solve and to the pendulum, a run in
// which nothing is moving at all.
//
// THE CONTROL IS A RUN WITH NOTHING MOVING, AND THEN THE GRIP MOVE IS COMPARED TO
// IT AND TO ITSELF. Two runs are driven over the same posed crane on the same
// emptied yard:
//
//   - the control's tape is one move whose target is its axis's current value,
//     which specs/program.md § Axis motion says "is done on the tick it is
//     issued": one tick under a live command, with nothing accelerating anywhere;
//   - the reading's tape is one `grip` move to `GRIP_TARGET` (`180`) at
//     `GRIP_MAX_RATE`, which under `GRIP_ACCEL` accelerates for half a second,
//     cruises for three and a half, and brakes for half.
//
// The reading's FIRST tick, on which the grip is accelerating hardest, must report
// the control's member forces exactly; and every later tick of it — cruising, then
// braking, then stopped at the target — must report the same forces again. A force
// the grip applied would have to be some function of its rate or its acceleration,
// and no such function is constant across a profile that accelerates one way,
// holds, and brakes the other while the run's own first tick is compared against a
// run where the grip never moved at all.
//
// AND THE BOB IS WATCHED THROUGHOUT, because "moves the bob not at all" is the
// other half of the same sentence: the hook hangs at the pivot minus
// `(0, HOIST_START, 0)` with zero velocity at the run's start (specs/rigging.md §
// The pivot and the bob), and there it must stay for every tick of the turn.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { GRIP_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type MemberForce,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the bob hangs at the run's start: the pivot minus `(0, L, 0)`. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The angle the grip is driven to: far enough to accelerate, cruise, brake. */
const GRIP_TARGET = 180;

/** Ticks the turn is allowed; at GRIP_MAX_RATE it takes some 270. */
const CAP = 400;

/**
 * How close two solves of a crane nothing moved have to come.
 *
 * Both runs assemble the same stiffness over the same geometry against the same
 * applied forces, so a conforming build's readings do not differ at all; the
 * least force the grip could plausibly apply is orders above this.
 */
const TOLERANCE = 1e-9;

/** A move whose target is the axis's value: one tick, and nothing moves. */
const STILL: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

/** The turn under test: half a revolution of the grip and nothing else. */
const TURN: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: GRIP_TARGET, rate: GRIP_MAX_RATE }],
};

/** The member forces of a tick, by member id. */
function byId(forces: readonly MemberForce[]): Map<number, number> {
  return new Map(forces.map((one) => [one.id, one.force]));
}

/** Everything a tick of either run is compared on. */
function readingOf(snapshot: GantrySnapshot): {
  forces: Map<number, number>;
  snapshot: GantrySnapshot;
} {
  return { forces: byId(snapshot.run.forces), snapshot };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Stand the crane on an emptied yard and start a run on `tape`. */
async function standAndRun(tape: readonly TapeStepSpec[]): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, tape);
  await startRun(h);
}

it("changes no member force and moves the bob while the grip turns", async () => {
  // The control: one tick of a run under a command that moves nothing.
  await standAndRun([STILL]);
  const still = readingOf(
    await runUntil(
      h,
      (s) => s.run.tick >= 1,
      2,
      "the control run's first tick",
    ),
  );
  assertGreaterThan(
    still.forces.size,
    0,
    "the members the standing crane reports a force for",
  );

  // The reading: the same crane with the grip turning through its whole profile.
  await standAndRun([TURN]);
  const turning: ReturnType<typeof readingOf>[] = [];
  await runUntil(
    h,
    (s) => {
      if (s.run.tick >= 1) turning.push(readingOf(s));
      return s.run.axes.grip.value >= GRIP_TARGET - 1e-9;
    },
    CAP,
    `the grip to reach ${GRIP_TARGET}`,
  );
  await h.capture("grip", "the grip driving with the crane otherwise still");

  assertGreaterThan(
    turning.length,
    120,
    `the ticks the grip took to reach ${GRIP_TARGET}, so the reading spans ` +
      "its acceleration, its cruise and its braking",
  );

  for (const [index, tick] of turning.entries()) {
    const { run } = tick.snapshot;
    for (const [id, force] of still.forces) {
      assertNear(
        tick.forces.get(id) as number,
        force,
        TOLERANCE,
        `member ${id}'s force on tick ${run.tick}, with the grip at ` +
          `${run.axes.grip.value.toFixed(3)} and turning at ` +
          `${run.axes.grip.rate.toFixed(3)} deg/s, against the same member on ` +
          "a run where nothing turned at all: turning the grip applies no " +
          "force to anything (specs/rigging.md § The grip)",
      );
    }
    for (const axis of ["x", "y", "z"] as const) {
      assertNear(
        run.bob.pos[axis],
        HOOK[axis],
        TOLERANCE,
        `the bob's ${axis} on tick ${run.tick}, with the grip turning: the ` +
          "grip moves the bob not at all (specs/rigging.md § The grip)",
      );
      assertNear(
        run.bob.vel[axis],
        0,
        TOLERANCE,
        `the bob's ${axis} velocity on tick ${run.tick}, with the grip turning ` +
          "(specs/rigging.md § The grip)",
      );
    }
    if (index === 0) {
      assertGreaterThan(
        Math.abs(run.axes.grip.rate),
        0,
        "the grip's rate on the first tick compared against the still run, so " +
          "the comparison is of a turning grip against a stopped one",
      );
    }
  }

  const ended = await h.snapshot();
  assertEqual(
    ended.run.axes.grip.value,
    GRIP_TARGET,
    "the grip at the end of its move (specs/program.md § Axis motion)",
  );
});
