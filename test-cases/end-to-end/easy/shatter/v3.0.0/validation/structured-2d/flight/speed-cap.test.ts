// flight/speed-cap — a ship already at the cap and burning along its own course
// never goes faster.
//
// THE RULE. `specs/ship.md`, "Inertial flight", the Speed cap row: "The speed is
// then clamped to `SHIP_MAX` (`680`). Thrust and carried momentum reach the cap
// but never pass it." `specs/simulation.md` puts that clamp at the end of the
// velocity step, after the tick's accelerations and after the drag, so it is the
// last word on the ship's speed every tick.
//
// WHAT IS MEASURED. The GREATEST speed the snapshot reports over two seconds of
// held thrust from a ship posed at exactly `SHIP_MAX`, against `SHIP_MAX + 1` —
// the bound the review item states. EVERY TICK IS READ, not the end alone,
// because a cap applied late or applied only sometimes shows as an excursion in
// the middle of a burn and is gone again by the end: a build that clamps once a
// SECOND rather than once a tick sits above the cap for 119 ticks out of every
// 120 and reads `680` at any moment a coarser sweep happened to look.
//
// WHY THE SHIP IS POSED AT THE CAP AND BURNS ALONG ITS OWN COURSE. Because that
// is the one pose where the cap is under continuous pressure. Thrust is taken
// along the facing (`specs/ship.md`), so with the facing laid along the velocity
// every tick adds `SHIP_THRUST * TICK_DT` (`4` units per second) to a speed
// already at `680` while the drag takes only `1.3` off it — the unclamped value
// is over the cap on every one of the two hundred and forty ticks, and a build
// that never clamps is `2.7` over within a single tick and ends the burn at
// `1196`.
//
// AND WHY THE COURSE IS OFF BOTH AXES. `115` degrees, so neither component of the
// velocity is the speed and neither is zero. A build that clamps the COMPONENTS
// to `SHIP_MAX` rather than the speed — `vx` and `vy` each held to `680` — is
// perfectly disguised on an axis, where the two readings coincide, and reaches
// `847` over these two seconds — `167` over the cap, on its way to an asymptote
// of `962`. So the check reads a different number for that model as well as for
// the model that clamps nothing.
//
// WHY ONE UNIT PER SECOND IS AN HONEST BOUND. The rule is a clamp, so a
// conforming build sits at `SHIP_MAX` exactly and has nothing to be off by but
// the rounding of the clamp's own division. The `1` also covers the one ordering
// the specification leaves visible: a build that clamps before the drag rather
// than after settles at `678.7`, which is under the cap and not over it. It
// covers none of the wrong models above.
//
// WHAT THIS DOES NOT DECIDE. That the ship REACHES `680`. A build whose clamp
// sits below the figure passes this reading, and the "reach the cap" half of the
// specification's sentence is not what the review item states. Nor how fast a
// burn from rest accelerates, which is `flight/thrust-accelerates`'s item.
//
// NOTHING ELSE IS RUNNING. `startPlaying` empties the field, shuts both world
// gates and shuts the ship's lethal contact test. The course is chosen so the
// whole two seconds stays `419` units from the star's centre at its closest —
// against the `44` at which `specs/collision.md`'s slide begins, which is the one
// rule that could take speed off the ship and which runs whether or not the
// lethal contact gate is on. It stays clear for the wrong models too, so their
// excursions are their own and not the slide's: the component-clamped burn's
// closest approach is `193` and the unclamped burn's is `128`. The ship crosses
// both seams during the burn and `specs/field.md` carries its velocity across;
// `field/wrap-carries-velocity` is the item for that.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_MAX } from "../../src/constants";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import { DEG } from "../geometry";
import {
  captureReplay,
  createHarness,
  holdAction,
  releaseAction,
  sampleEvery,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Where the burn begins and which way it runs.
 *
 * `115` degrees is off both axes and off the diagonals, and from this point the
 * whole two seconds of a conforming burn — two seam crossings included — never
 * comes within `419` units of the star's centre.
 */
const SHIP_X = 220;
const SHIP_Y = 260;
const FACING = 115 * DEG;

/** The velocity the ship is posed with: `SHIP_MAX` along that course. */
const POSED = {
  vx: Math.cos(FACING) * SHIP_MAX,
  vy: Math.sin(FACING) * SHIP_MAX,
};

/** The burn the review item names: two seconds of game time with the key down. */
const BURN_TICKS = ticksFor(2);

/**
 * How often the speed is read, in ticks.
 *
 * Every tick. `specs/simulation.md` runs the whole velocity step, the clamp
 * included, once a tick, so an excursion can be one tick long — and a sweep that
 * skipped ticks would be a check on how OFTEN a build clamps rather than on
 * whether it does.
 */
const READ_EVERY = 1;

/**
 * How far over `SHIP_MAX` the speed may go, in units per second.
 *
 * One unit, which is the figure the review item states. A conforming build sits
 * at `SHIP_MAX` exactly; the unit is the rounding of the clamp's own division.
 */
const OVERSHOOT_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never lets a burn take the ship past SHIP_MAX", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipAngle(FACING);
  h.debug.setShipVelocity(POSED.vx, POSED.vy);

  assertCloseTo(
    h.snapshot().ship.speed,
    SHIP_MAX,
    1,
    "the ship posed at SHIP_MAX before the burn, so the burn presses on the " +
      "cap from its first tick (specs/instrumentation.md: setShipVelocity)",
  );

  const flight = await captureReplay(h, "capped", async () => {
    holdAction(h, "up");
    try {
      return await sampleEvery(h, BURN_TICKS, READ_EVERY, (snapshot) => ({
        speed: snapshot.ship.speed,
        thrusting: snapshot.ship.thrusting,
      }));
    } finally {
      releaseAction(h, "up");
    }
  });

  // The burn has to have been burning, or the reading below decides nothing.
  // Not the rate — that is `flight/thrust-accelerates`'s item — only that the
  // held key was reaching the ship, as `specs/controls.md` reads it.
  assertEqual(
    flight[flight.length - 1].thrusting,
    true,
    "the ship still reporting thrust at the end of the burn, with the key " +
      "held throughout — thrust is read as a hold (specs/controls.md)",
  );

  const fastest = flight.reduce(
    (best, sample, index) =>
      sample.speed > best.speed ? { speed: sample.speed, index } : best,
    { speed: flight[0].speed, index: 0 },
  );

  assertLessThanOrEqual(
    fastest.speed,
    SHIP_MAX + OVERSHOOT_TOLERANCE,
    `the greatest speed over ${String(BURN_TICKS)} ticks of held thrust from a ` +
      `ship already at SHIP_MAX (${String(SHIP_MAX)}), on a course off both ` +
      `axes, to be at most ${String(SHIP_MAX + OVERSHOOT_TOLERANCE)} — thrust ` +
      "and carried momentum reach the cap but never pass it (specs/ship.md); " +
      `read every tick, fastest at tick ${String(fastest.index)}`,
  );
});
