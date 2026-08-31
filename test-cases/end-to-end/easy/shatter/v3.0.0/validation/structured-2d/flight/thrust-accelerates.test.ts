// flight/thrust-accelerates — a second of burn from rest reaches the speed the
// thrust and the drag together fix, not the bare acceleration.
//
// THE RULE. `specs/ship.md`, "Inertial flight", two rows read together. Thrust:
// "While the thrust key is held, an acceleration of `SHIP_THRUST` (`480` units
// per second squared) is added along the current facing." Drag: "The velocity is
// multiplied by `0.5 ^ (TICK_DT / SHIP_DRAG_HALFLIFE)` with
// `SHIP_DRAG_HALFLIFE` (`3.0` seconds)". A second of burn from rest is therefore
// NOT `480`: each tick's four units are dragged for whatever is left of the
// second, and the sum comes to about `428`. That composition is what this item
// decides.
//
// WHAT IS MEASURED. The speed the snapshot reports after `SHIP_TURN`-free,
// gravity-free, contact-free second of held thrust, against
// {@link burnFromRest}, which is the specification's own per-tick step summed
// over the same second. The MAGNITUDE alone: which way the velocity points is
// `flight/thrust-along-facing`'s item, and a build wrong in the direction and
// right in the magnitude must lose that point and not this one.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that applies no
// drag at all reaches `480` and is `51.8` out. A build that adds `SHIP_THRUST` as
// a VELOCITY rather than as an acceleration sits at `479` from its first tick and
// is `51` out. A build that adds `SHIP_THRUST` once a tick without `TICK_DT`
// leaves the second at `51380`. A build that halves or doubles the figure reads
// `214` or `856`. The bound is `21.4`.
//
// WHAT THIS ITEM DOES NOT DECIDE, AND WHICH ONE DOES. The DRAG LAW. A build whose
// half-life is merely wrong rather than absent moves this reading very little —
// reading the drag as a linear per-tick coefficient, `v * (1 - TICK_DT /
// SHIP_DRAG_HALFLIFE)`, halves in `2.08` seconds instead of three and still
// reaches `407.5` here, inside this bound. That build is decided by
// `flight/drag-halves-in-three-seconds`, which reads the coast where the law is
// the whole of what is happening; this item is the composition of a burn with a
// drag, and its business is the burn.
//
// WHAT THE BOUND HAS TO COVER, AND WHY 5 PERCENT IS HONEST. The review item
// states 5 percent, and inside it sit exactly three things the specification
// leaves open. A build that reads its input one tick behind the press burns for
// 119 ticks rather than 120 and lands `3.2` low. A build that drags BEFORE it
// thrusts rather than after — an order `specs/ship.md` fixes but which costs one
// multiplication by `0.998` — lands `0.8` high. And the closed-form integral a
// build may have solved instead of stepping is `0.4` high. Together they are a
// fifth of the bound; the rest is room for a build's own arithmetic, not room on
// the figure.
//
// THE POSE IS AT REST, OFF EVERY AXIS AND FAR FROM THE CORE. At rest so the whole
// of the reading is what the burn built, and the pose is read back before the
// burn so a build whose `setShipVelocity` did not take fails on that rather than
// on the sum. Off every axis so no accidental alignment can flatter a build. Far
// from the core because `specs/collision.md`'s slide runs whatever the ship's
// lethal contact gate says: over the second the ship covers `196` units from
// `(200, 200)` along `-35` degrees, which never brings it within `380` of the
// star's centre, against the `44` at which the slide begins. The well itself
// never pulls the ship at all (`specs/ship.md`), so nothing but the burn and the
// drag touches this reading.

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../../src/constants";
import { assertCloseTo, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdActionFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { burnFromRest } from "./motion";

/** Where the ship is posed, and which way it faces: off both axes, clear of the core. */
const SHIP_X = 200;
const SHIP_Y = 200;
const FACING = -35 * DEG;

/** The burn the review item names: one second of game time with the key down. */
const BURN_TICKS = ticksFor(1);

/** The speed `specs/ship.md`'s two rows fix for that burn, about `428.2`. */
const WANTED = burnFromRest(BURN_TICKS);

/**
 * How far the speed may fall from it, in units per second.
 *
 * 5 percent of the specified speed, which is the figure the review item states.
 * That is `21.4`, against the `4.0` a one-tick input lag costs, the `0.8` the
 * thrust/drag order is worth and the `0.4` between the stepped sum and the
 * closed-form integral — so it is room for a build's arithmetic rather than room
 * on the figure.
 */
const SPEED_TOLERANCE = 0.05 * WANTED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches SHIP_THRUST's second of burn less what the drag removes", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACING);

  assertCloseTo(
    h.snapshot().ship.speed,
    0,
    3,
    "the ship at rest before the burn, so the whole of the speed read after " +
      "it is what the burn built (specs/instrumentation.md: setShipVelocity)",
  );

  await holdActionFor(h, "up", BURN_TICKS);
  const ship = h.snapshot().ship;
  // The ship at the end of the burn, with its flame still lit.
  captureStill(h, "thrust");

  assertLessThanOrEqual(
    Math.abs(ship.speed - WANTED),
    SPEED_TOLERANCE,
    `the ship's speed within ${SPEED_TOLERANCE.toFixed(1)} units per second ` +
      `of ${WANTED.toFixed(1)}, which is SHIP_THRUST (480) applied along the ` +
      "facing for one second and dragged at SHIP_DRAG_HALFLIFE (3.0 s) " +
      "throughout (specs/ship.md); a bare 480 is a build that dropped the drag " +
      "altogether",
  );
});
