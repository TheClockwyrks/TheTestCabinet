// flight/rotation-keeps-velocity — turning changes the facing and nothing else.
//
// THE RULE. `specs/ship.md`, in as many words: "Rotation changes the facing alone
// and never the velocity." It is the sentence that makes the ship INERTIAL rather
// than steered — the momentum a player built stays where it was pointed until
// thrust is spent against it, which is why the same file can say "It has no
// reverse and no brake: speed is killed by turning around and thrusting against
// the motion."
//
// THE SCENARIO, AND THE WRONG MODELS IT SEPARATES. A ship is posed drifting at
// 300 units per second along one bearing while FACING another, 45 degrees off it,
// and a turn action is then held for a second with no thrust. What the velocity
// does over that second is the whole reading:
//
//   - a build that carries the facing into the velocity — steering the drift
//     round with the nose, which is the commonest way to get this wrong — turns
//     the drift through the same 300 degrees, and ends about 238 units per second
//     away from where the velocity should be;
//   - a build that leaks thrust into a turn adds up to 428 units per second;
//   - a build that zeroes or damps the velocity when a turn key goes down loses
//     the whole 238;
//   - a conformant build's velocity is its posed velocity multiplied by the drag
//     alone, `(0.5 ^ (TICK_DT / SHIP_DRAG_HALFLIFE)) ^ 120` over the second, so
//     238.11 units per second along the bearing it was posed on and no other.
//
// THE READING IS THE DIFFERENCE BETWEEN THE WHOLE VELOCITY VECTOR and that
// prediction, so direction and magnitude are one comparison rather than two, and
// the item stays a single requirement in a single direction.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the turn happened at all: a build whose
// turn action does nothing leaves the velocity exactly where it was and passes
// here, and fails `flight/turn-rate-left`, which is the item the rotation itself
// belongs to. Grading the rate here as well would take two points off one defect.
//
// WHY THREE PERCENT OF THE DRIFT. Nine units per second. The drag over a second
// is fixed exactly by `specs/ship.md` and no thrust is in play, so the only slack
// a conformant build has is which tick the key edge lands on — one tick of drag
// is 0.19 percent — and nine units is far below the 238 a steered drift, a zeroed
// drift, or a leaked thrust would move the reading by.
//
// WHERE IT IS FLOWN. The second of coasting covers 268 units from `(60, 660)` at
// a bearing of `-45` degrees, and the ship's centre never comes within 400 units
// of the star's — against the `44` at which `specs/collision.md` has the core
// slide it off and take the velocity being measured with it. The run stays inside
// the field, so the wrap never enters. The well never pulls the ship
// (`specs/gravity.md`), and `startPlaying` has emptied the field and shut both
// world gates.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, FACE_UP, SHIP_DRAG_HALFLIFE, TICK_DT } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { holdFor } from "./drive";

/** The speed the ship is posed drifting at. */
const DRIFT_SPEED = 300;

/** The bearing it drifts along: 45 degrees off the facing it is posed on. */
const DRIFT_BEARING = -45 * DEG;

/** Where the drift begins. See the header for why this line and not another. */
const START = { x: 60, y: 660 };

/** The second of held rotation the item names. */
const TURN_TICKS = ticksFor(1);

/** The factor `specs/ship.md` multiplies the velocity by on every tick. */
const DRAG_PER_TICK = Math.pow(0.5, TICK_DT / SHIP_DRAG_HALFLIFE);

/** What the drag alone leaves of the drift over that second: 0.7937 of it. */
const DRAG_OVER_TURN = Math.pow(DRAG_PER_TICK, TURN_TICKS);

/** Three percent of the posed drift: nine units per second. See the header. */
const DRIFT_TOLERANCE = DRIFT_SPEED * 0.03;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the drift where it was pointed while the facing turns", async () => {
  startPlaying(h);
  const drift = {
    vx: Math.cos(DRIFT_BEARING) * DRIFT_SPEED,
    vy: Math.sin(DRIFT_BEARING) * DRIFT_SPEED,
  };
  h.debug.setShipPosition(START.x, START.y);
  // Posed 45 degrees off the drift, so a build that steers the drift with the
  // nose has somewhere to steer it to from the very first tick.
  h.debug.setShipAngle(FACE_UP);
  h.debug.setShipVelocity(drift.vx, drift.vy);

  await holdFor(h, keyFor("left"), TURN_TICKS);
  const turned = h.snapshot();
  captureStill(h, "drift");

  const expected = {
    vx: drift.vx * DRAG_OVER_TURN,
    vy: drift.vy * DRAG_OVER_TURN,
  };
  assertLessThanOrEqual(
    Math.hypot(turned.ship.vx - expected.vx, turned.ship.vy - expected.vy),
    DRIFT_TOLERANCE,
    "how far a second of held rotation moved the velocity from what the drag " +
      "alone leaves of the drift it was posed with, in units per second — " +
      "rotation changes the facing alone and never the velocity (specs/ship.md)",
  );
});
