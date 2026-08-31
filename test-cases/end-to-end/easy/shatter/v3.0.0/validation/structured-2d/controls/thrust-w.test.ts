// controls/thrust-w — `KeyW` thrusts.
//
// `specs/controls.md`'s bindings table gives the `up` action TWO keys, `ArrowUp`
// and `KeyW`, and gives `up` its meaning while playing — Thrust. A build that
// registered only the arrow has a game that plays, so this point is capped lower
// than its arrow twin — but it is a separate point, because the second key is a
// separate deliverable and a build that shipped one and not the other should lose
// exactly one of them.
//
// THE KEY IS DRIVEN, NOT THE ACTION. This is the whole reason the item exists.
// `harness.ts`'s `holdAction` and `holdActionFor` drive an action's FIRST bound
// key — `ArrowUp` for `up` — so a check written through them would grade the two
// keys as one and pass a build with no `KeyW` binding at all. The literal
// `KeyboardEvent.code` goes down instead, at the event target the engine's input
// system listens on, so the action is raised by the binding the case declares
// rather than by anything this check reaches into.
//
// `KeyW` IS DOUBLE-DUTY, AND THE SCREEN SETTLES IT. The same key moves a menu
// selection up (`controls/menu-w`), so the burn is driven on the `playing` screen
// `startPlaying` poses, where `specs/controls.md` gives `up` its thrust meaning.
//
// THE SHIP IS TURNED ACROSS THE FIELD FIRST. `startPlaying` leaves it at the safe
// point facing `FACE_UP`, which points it straight at the star: a burn from there
// flies the ship into the core, and `specs/collision.md` has the core turn the
// ship's inward speed away — a system this point is not about, changing the very
// quantity it reads. Facing `+x`, the burn crosses empty field two hundred units
// clear of the star, and the star never pulls the ship (`specs/ship.md`) so
// nothing else touches its velocity.
//
// THE RATE IS NOT THE REQUIREMENT. `flight/thrust-accelerates` decides the figure
// and `flight/thrust-along-facing` the direction; asserting either here would cost
// one build two items for one fault. What this asserts is that the key moved a
// ship that was standing still, and that the build reported thrust while it did.
//
// WHAT THIS DOES NOT DECIDE. The acceleration figure, the direction thrust acts
// in, that thrust stops on release (`controls/thrust-up`, whose item states that
// clause), what `KeyW` does on a menu (`controls/menu-w`), and the arrow binding
// itself.

import { afterEach, beforeEach, it } from "vitest";
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
const KEY = "KeyW";

/**
 * The facing the burn is flown along: `+x`, across the field and clear of the
 * star's core, which the safe point's own `FACE_UP` would fly straight into.
 */
const ACROSS_THE_FIELD = 0;

/** The quiet stretch driven before the key goes down, in ticks. */
const LEAD_TICKS = ticksFor(0.25);

/** The burn, in ticks: half a second of held thrust, as its arrow twin burns. */
const HOLD_TICKS = ticksFor(0.5);

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accelerates the ship while KeyW is held", async () => {
  // Live play on the empty, quiet field, with the ship at the safe point at rest
  // and turned across the field, clear of the star's core.
  startPlaying(h);
  h.debug.setShipAngle(ACROSS_THE_FIELD);

  const lead = await burnAcross(h, LEAD_TICKS);
  const burn = await burnAcross(h, HOLD_TICKS, KEY);
  captureStill(h, "thrust");

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
    AT_REST,
    `the ship's speed in units per second after ${String(HOLD_TICKS)} ticks ` +
      `with ${KEY} held, from a standstill — KeyW drives the same up action ` +
      "ArrowUp does (specs/controls.md), which thrusts while the game is being " +
      "played, and thrust accelerates the ship (specs/ship.md)",
  );
  assertEqual(
    burn.endedThrusting,
    true,
    `the build's own thrusting flag on the last tick of the ${KEY} hold — ` +
      "thrust is applied for as long as the key is down (specs/controls.md)",
  );
});
