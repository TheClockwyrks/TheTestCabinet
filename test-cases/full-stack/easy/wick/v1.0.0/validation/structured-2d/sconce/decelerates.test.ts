// sconce/decelerates — a sconce's velocity falls at SCONCE_DECEL along its
// launch direction.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): a sconce's
// "velocity along `d` falls under a constant acceleration of `−SCONCE_DECEL`
// (`600`) units per second squared ... so after `n` moving ticks its velocity
// is `(speed − SCONCE_DECEL × n × TICK_DT) × d`". With level 1's `speed` of
// 600 and `n` of 30, that is `(600 − 600 × 30 / 60) × d` = `300 × d`, half the
// speed it launched at after half a second of motion. Along `d` of
// `(0.6, 0.8)` the velocity reads `(180, 240)`.
//
// WHY 30 TICKS. Half of the `speed / SCONCE_DECEL` = 1 second the sconce
// takes to reverse, so the reading falls where the velocity is still along
// `d` and plainly slower; the reversal itself is `reverses`'s point. 30 ticks
// is far short of the posed sconce's `ttl` of 2.5 seconds, 150 ticks
// (`specs/world.md`, Timers), so it is still in the world to read.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one posed sconce
// and nothing else, with `effectMotion` on so "the sconces decelerate"
// (`specs/world.md`, phase 6) and every other switch off, so no enemy is
// there to hit and remove it, no weapon fires a second one, and no passive
// scales a figure. Where the launch direction comes from is
// `launch-direction`'s point; here it is given.
//
// THE TOLERANCE. `MOTION_EPS` on the velocity: 30 additions of a constant
// times `TICK_DT`, each rounding by an ulp. A sconce that never decelerated
// still reads `600 × d`, 300 units per second away; one that decelerated at
// the wrong rate is off by units per second per tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertPointNear } from "../assert";
import { MOTION_EPS } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { LAUNCH_DIRECTION } from "./firing";
import { placeSconce, poseFlight, speedAfter, traceSconce } from "./flight";

/** How many moving ticks the sconce is carried for: half its second of motion. */
const TICKS = 30;

/** `(speed − SCONCE_DECEL × 30 × TICK_DT) × d` = `300 × d`. */
const VELOCITY = {
  x: speedAfter(TICKS) * LAUNCH_DIRECTION.x,
  y: speedAfter(TICKS) * LAUNCH_DIRECTION.y,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the sconce at 300 × d after 30 moving ticks", async () => {
  poseFlight(h);
  const sconce = placeSconce(h, 0, 0, LAUNCH_DIRECTION);

  const trace = await captureReplay(h, "slowing", () =>
    traceSconce(h, sconce, TICKS),
  );

  const last = trace[TICKS - 1];
  assertPointNear(
    { x: last.vx, y: last.vy },
    VELOCITY,
    MOTION_EPS,
    `the sconce's velocity after ${TICKS} moving ticks, against (speed − SCONCE_DECEL × n × TICK_DT) × d (specs/weapons.md, Sconce)`,
  );
});
