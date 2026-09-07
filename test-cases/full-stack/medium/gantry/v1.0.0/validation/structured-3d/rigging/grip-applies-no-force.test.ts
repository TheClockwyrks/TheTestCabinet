// rigging/grip-applies-no-force — turning the grip applies no force to anything.
//
// specs/rigging.md § The grip says it in four words: "Turning the grip applies no
// force to anything." The grip is a powered swivel in the hook and nothing else —
// it is not an arm node with a radius, it has no mass in specs/statics.md § The
// load model, and no term of the cable tension reads it. So a run in which the
// grip is the only thing moving is, to the solve and to the pendulum, a run in
// which nothing is moving at all.
//
// THE CONTROL AND THE READING ARE ONE RUN. The tape carries two steps, so a
// single run over a single posed crane gives both:
//
//   - step one is a move whose target is its axis's current value, which
//     specs/program.md § Axis motion says "is done on the tick it is issued": the
//     run's FIRST tick passes with nothing accelerating anywhere, and the member
//     forces it solves are the control;
//   - step two is a `grip` move to `GRIP_TARGET` (`30`) at `GRIP_MAX_RATE`, taken
//     on the tick after (specs/program.md § The tick pipeline), which under
//     `GRIP_ACCEL` accelerates for half a second, cruises, and brakes for half a
//     second.
//
// ONE RUN RATHER THAN TWO, DELIBERATELY. The control tick and the turning ticks
// belong to the same run over the same posed crane, so nothing but the grip
// stands between them, and the point reads the grip alone rather than whatever
// separates two runs.
//
// Every turning tick — accelerating, cruising, braking, and stopped at the target
// — must report the control tick's member forces exactly. A force the grip
// applied would have to be some function of its rate or its acceleration, and no
// such function is constant across a profile that accelerates one way, holds, and
// brakes the other while the first turning tick is compared against a tick of the
// same run on which the grip had not moved at all.
//
// AND THE BOB IS WATCHED THROUGHOUT, because "moves the bob not at all" is the
// other half of the same sentence: the hook hangs at the pivot minus
// `(0, HOIST_START, 0)` with zero velocity at the run's start (specs/rigging.md §
// The pivot and the bob), and there it must stay for every tick of the turn.
//
// THE YARD IS EMPTIED and the smallest crane that stands carries the run: this
// point is about a swivel in the hook, so nothing about the site, its loads or
// its obstacles is on the way to it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { GRIP_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
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

/**
 * The angle the grip is driven to: the shortest turn that has all three phases.
 *
 * Under `GRIP_ACCEL` (`90`) the grip reaches `GRIP_MAX_RATE` (`45`) in half a
 * second, covering `11.25` degrees, and needs the same to stop. A target of `30`
 * therefore accelerates for thirty ticks, CRUISES for ten, and brakes for thirty
 * — the whole profile the comparison needs, in seventy ticks rather than the two
 * hundred and seventy a half revolution would spend saying the same thing.
 */
const GRIP_TARGET = 30;

/** Ticks the turn is allowed; at this profile it takes some 70. */
const CAP = 150;

/** Ticks the profile cannot come in under, so all three phases are covered. */
const PHASES = 60;

/**
 * How close two solves of a crane nothing moved have to come.
 *
 * Both ticks assemble the same stiffness over the same geometry against the same
 * applied forces, so a conforming build's readings do not differ at all; the
 * least force the grip could plausibly apply is orders above this.
 */
const TOLERANCE = 1e-9;

/** A move whose target is the axis's value: one tick, and nothing moves. */
const STILL: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

/** The turn under test: the grip driven to its target and nothing else. */
const TURN: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: GRIP_TARGET, rate: GRIP_MAX_RATE }],
};

/** The member forces of a tick, by member id. */
function byId(forces: readonly MemberForce[]): Map<number, number> {
  return new Map(forces.map((one) => [one.id, one.force]));
}

/** Everything a tick of the run is compared on. */
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

it("changes no member force and moves the bob while the grip turns", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [STILL, TURN]);
  await startRun(h);

  // The control: the run's first tick, which takes the still step and completes
  // it without moving anything (specs/program.md § Axis motion).
  const still = readingOf(await runTicks(h, 1));
  assertEqual(
    still.snapshot.run.axes.grip.value,
    0,
    "the grip on the control tick, which the still step leaves where a run " +
      "starts it (specs/program.md § The axes)",
  );
  assertGreaterThan(
    still.forces.size,
    0,
    "the members the standing crane reports a force for",
  );

  // The reading: the same run, with the grip turning through its whole profile.
  const turning: ReturnType<typeof readingOf>[] = [];
  await runUntil(
    h,
    (s) => {
      if (s.run.tick >= 2) turning.push(readingOf(s));
      return s.run.axes.grip.value >= GRIP_TARGET - 1e-9;
    },
    CAP,
    `the grip to reach ${GRIP_TARGET}`,
  );
  await h.capture("grip", "the grip driving with the crane otherwise still");

  assertGreaterThan(
    turning.length,
    PHASES - 1,
    `the ticks the grip took to reach ${GRIP_TARGET}, so the reading spans ` +
      "its acceleration, its cruise and its braking",
  );
  assertEqual(
    Math.max(
      ...turning.map((tick) => Math.abs(tick.snapshot.run.axes.grip.rate)),
    ),
    GRIP_MAX_RATE,
    "the fastest the grip turned over the reading, so the profile compared " +
      "reached its commanded rate and cruised there (specs/program.md § Axis " +
      "motion)",
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
          "the tick of this run where nothing turned at all: turning the grip " +
          "applies no force to anything (specs/rigging.md § The grip)",
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
        "the grip's rate on the first turning tick compared against the still " +
          "tick, so the comparison is of a turning grip against a stopped one",
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
