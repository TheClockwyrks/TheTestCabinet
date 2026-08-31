// flight/rotation-keeps-velocity — turning changes the facing and nothing else.
//
// THE RULE. `specs/ship.md`, in as many words: "Rotation changes the facing alone
// and never the velocity." It is the sentence that makes the ship INERTIAL rather
// than steered — the momentum a player built stays where it was pointed until
// thrust is spent against it, and "It has no reverse and no brake: speed is
// killed by turning around and thrusting against the motion."
//
// THE SCENARIO, AND THE TWO WRONG MODELS IT SEPARATES. A ship is posed drifting
// at 300 units per second along one bearing while FACING another, 45 degrees off
// it, and the left key is then held for a second with no thrust. What the
// velocity does over that second is the whole reading:
//
//   - a build that carries the facing into the velocity — steering the drift
//     round with the nose, which is the commonest way to get this wrong — turns
//     the drift through the same 300 degrees, and its velocity ends 238 units per
//     second away from where it should be;
//   - a build that leaks thrust into a turn adds up to 428 units per second;
//   - a conformant build's velocity is its posed velocity multiplied by the drag
//     alone, `0.5 ^ (1 / SHIP_DRAG_HALFLIFE)` over the second, so 238.11 units
//     per second along the bearing it was posed on and no other.
//
// The reading is the DIFFERENCE between the whole velocity vector and that
// prediction, so direction and magnitude are one comparison rather than two, and
// the item is a single requirement in a single direction.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the turn happened at all: a build whose
// left key does nothing leaves the velocity alone and passes here, and fails
// `flight/turn-rate-left`, which is the item the rotation itself belongs to.
// Grading the rate here as well would take two points off one defect.
//
// WHY THREE PERCENT OF THE DRIFT. Nine units per second. The drag over a second
// is fixed exactly by `specs/ship.md` and no thrust is in play, so the only slack
// a conformant build has is which tick the key edge lands on — one tick of drag
// is 0.19 percent — and nine units is far below the 238 a steered drift or the
// 428 a leaked thrust would move the reading by.
//
// WHERE IT IS FLOWN. The second of coasting covers 268 units from `(60, 660)` at
// a bearing of `-45` degrees, and the ship's centre never comes within 400 units
// of the star's — against the `44` at which `specs/collision.md` has the core
// slide it off and take the velocity being measured with it. The well never pulls
// the ship (`specs/gravity.md`), and `startPlaying` has emptied the field and shut
// both world gates.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  DEG,
  FACE_UP,
  KEYS_LEFT,
  SHIP_DRAG_HALFLIFE,
  TICK_DT,
} from "../constants";
import { magnitude, scale, subtract, unitAt } from "../geometry";
import {
  captureStill,
  createHarness,
  shipVelocity,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

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

/** Three percent of the posed drift: nine units per second. */
const DRIFT_TOLERANCE = DRIFT_SPEED * 0.03;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves the drift where it was pointed while the facing turns", async () => {
  await startPlaying(harness);
  const drift = scale(unitAt(DRIFT_BEARING), DRIFT_SPEED);
  await harness.debug.setShipPosition(START.x, START.y);
  await harness.debug.setShipAngle(FACE_UP);
  await harness.debug.setShipVelocity(drift.x, drift.y);

  await harness.holdFor(KEYS_LEFT[0], TURN_TICKS);
  const turned = shipVelocity(await harness.snapshot());
  await captureStill(harness, "drift");

  const expected = scale(drift, DRAG_OVER_TURN);
  assertLessThanOrEqual(
    magnitude(subtract(turned, expected)),
    DRIFT_TOLERANCE,
    "how far a second of turning moved the drift from what the drag alone leaves of it",
  );
});
