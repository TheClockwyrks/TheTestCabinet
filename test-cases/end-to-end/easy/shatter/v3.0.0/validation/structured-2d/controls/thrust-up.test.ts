// controls/thrust-up — `ArrowUp` thrusts.
//
// `specs/controls.md` binds `ArrowUp` to the `up` action and gives `up` its
// meaning while playing — Thrust — and `specs/ship.md` says what thrust does:
// "While the thrust key is held, an acceleration of `SHIP_THRUST` ... is added
// along the current facing." The same file makes the reading a HOLD —
// `specs/controls.md`: "the ship turns and accelerates for as long as the key is
// down and stops the moment it is released" — so this point is decided over THREE
// stretches: the ship at rest with nothing down, the key held, and the ship
// coasting after it comes up.
//
// THE KEY IS DRIVEN, NOT THE ACTION. `specs/instrumentation.md` carries no
// operation that thrusts, and no operation that raises an action either: the
// keyboard belongs to the engine beneath the game, and this point is about one
// BINDING, so the literal `KeyboardEvent.code` the specification's table names is
// what goes down. `harness.ts`'s `holdAction` drives an action's FIRST bound key,
// which would grade `ArrowUp` and `KeyW` as one thing; the whole point of this
// item and of `controls/thrust-w` is that they are two.
//
// THE SHIP IS TURNED ACROSS THE FIELD FIRST. `startPlaying` leaves it at the safe
// point facing `FACE_UP`, which points it straight at the star: a burn from there
// flies the ship into the core, and `specs/collision.md` has the core turn the
// ship's inward speed away — a system this point is not about, changing the very
// quantity it reads. Facing `+x`, the burn crosses empty field two hundred units
// clear of the star, and the star never pulls the ship
// (`specs/ship.md`) so nothing else touches its velocity.
//
// TWO READINGS, ONE FOR EACH HALF OF THE HOLD.
//
//   * WHILE THE KEY IS DOWN the ship gains speed from a standstill, and the
//     build's own `thrusting` reports thrust being applied. Speed alone would pass
//     a build that reports the flag and never accelerates; the flag alone would
//     pass one that accelerates and never reports it. `specs/ui.md` and
//     `specs/instrumentation.md` make `thrusting` the field the drawn flame and
//     the held `thrust` cue are keyed off, so both readings are the item's.
//   * AFTER IT COMES UP the ship coasts: `thrusting` is off and no tick raises the
//     speed. Drag can only ever take speed away (`specs/ship.md`), so a rise is
//     thrust that never stopped.
//
// THE RATE IS NOT THE REQUIREMENT, BUT A FLOOR IS. `flight/thrust-accelerates`
// decides that a second of thrust from rest leaves the ship at `SHIP_THRUST` less
// drag, within five percent, and `flight/thrust-along-facing` decides the
// direction it acts in. Asserting either here would cost one build two items for
// one fault. So what this asserts about the size of the burn is a floor HALF of
// it (`THRUST_FLOOR`): a build near the stated acceleration clears it by nearly a
// factor of two, while a build that merely moved a ship that was standing still —
// which is all a bare `AT_REST` reading would ask, and which the check's own
// rounding allowance for the QUIET lead already grants — does not.
//
// WHAT THIS DOES NOT DECIDE. The acceleration figure, the direction thrust acts
// in, the drag that bleeds the coast off (`flight/drag-halves-in-three-seconds`),
// the drawn flame (`presentation/thrust-flame-while-thrusting`), the held cue
// (`audio/thrust-cue-starts` and `audio/thrust-cue-stops`), and the `KeyW`
// binding, which is `controls/thrust-w`'s.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_THRUST, TICK_DT } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { burnAcross } from "./keys";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "ArrowUp";

/**
 * The facing the burn is flown along: `+x`, across the field and clear of the
 * star's core, which the safe point's own `FACE_UP` would fly straight into.
 */
const ACROSS_THE_FIELD = 0;

/** The quiet stretch driven before the key goes down, in ticks. */
const LEAD_TICKS = ticksFor(0.25);

/** The burn, in ticks: half a second of held thrust. */
const HOLD_SECONDS = 0.5;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);
/**
 * The least speed the burn must reach, in units per second.
 *
 * HALF of what `SHIP_THRUST` (`480` units per second squared) is worth over the
 * held span before drag takes its share — the drag `specs/ship.md` fixes
 * (`SHIP_DRAG_HALFLIFE`, `3.0` seconds) leaves about ninety-five per cent of it —
 * so a build within the five per cent `flight/thrust-accelerates` allows clears
 * this by nearly a factor of two, and a build that merely nudged the ship does
 * not.
 *
 * WHY NOT `AT_REST`. Reading only that the ship is no longer standing still is met
 * by a build with no such binding at all: a hundredth of a unit per second is the
 * allowance this same check makes for the QUIET lead, so a ship that never
 * thrusts and merely rounds its velocity satisfies both halves. The floor is what
 * makes the reading mean "the key accelerated the ship".
 */
const THRUST_FLOOR = 0.5 * SHIP_THRUST * HOLD_SECONDS;

/** The coast driven after the key comes up, in ticks. */
const COAST_TICKS = ticksFor(0.25);

/**
 * The speed a ship posed at rest may report, in units per second.
 *
 * `startPlaying` poses the velocity at exactly `(0, 0)` and `specs/ship.md` leaves
 * nothing but thrust able to add to it — drag multiplies, and the star never pulls
 * the ship — so a ship with no thrust key down stays at exactly rest. A hundredth
 * of a unit per second is the allowance for a build that carries its velocity
 * through a rounding of its own.
 */
const AT_REST = 0.01;

/**
 * The rise in speed one coasting tick may show, in units per second.
 *
 * An eighth of `SHIP_THRUST * TICK_DT` (`4` units per second, the speed one tick
 * of the specified acceleration adds), so a build still thrusting after the
 * release exceeds it on its very first tick. Drag alone can only ever reduce the
 * speed (`specs/ship.md`), so any rise beyond arithmetic noise is thrust.
 */
const COASTING_RISE = (SHIP_THRUST * TICK_DT) / 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accelerates the ship while ArrowUp is held, and stops thrusting on release", async () => {
  // Live play on the empty, quiet field, with the ship at the safe point at rest
  // and turned across the field, clear of the star's core.
  startPlaying(h);
  h.debug.setShipAngle(ACROSS_THE_FIELD);

  const lead = await burnAcross(h, LEAD_TICKS);
  const burn = await burnAcross(h, HOLD_TICKS, KEY);
  captureStill(h, "thrust");
  const coast = await burnAcross(h, COAST_TICKS);

  assertLessThanOrEqual(
    lead.ended,
    AT_REST,
    `the ship's speed in units per second after ${String(LEAD_TICKS)} ticks ` +
      "with no key down, before the hold — a ship posed at rest stays at rest " +
      "(specs/ship.md)",
  );
  assertEqual(
    lead.thrusting.some(Boolean),
    false,
    `whether the build reported thrust on any of the ${String(LEAD_TICKS)} ` +
      "ticks before the key went down — thrust is applied only while the key " +
      "is held (specs/controls.md)",
  );
  assertGreaterThan(
    burn.ended,
    THRUST_FLOOR,
    `the ship's speed in units per second after ${String(HOLD_TICKS)} ticks ` +
      `with ${KEY} held, from a standstill — ArrowUp drives the up action, ` +
      "which thrusts while the game is being played (specs/controls.md), and " +
      "thrust accelerates the ship (specs/ship.md)",
  );
  assertEqual(
    burn.endedThrusting,
    true,
    `the build's own thrusting flag on the last tick of the ${KEY} hold — ` +
      "thrust is applied for as long as the key is down (specs/controls.md)",
  );
  assertEqual(
    coast.endedThrusting,
    false,
    `the build's own thrusting flag ${String(COAST_TICKS)} ticks after ${KEY} ` +
      "came up — thrust stops the moment the key is released " +
      "(specs/controls.md)",
  );
  assertLessThanOrEqual(
    coast.biggestRise,
    COASTING_RISE,
    "the largest rise in speed any single tick of the coast made, in units " +
      "per second — with no thrust key down only drag acts on the velocity, " +
      "and drag can only take speed away (specs/ship.md)",
  );
});
