// bullets/fire-rate — a held key takes one shot every FIRE_INTERVAL_TICKS.
//
// specs/weapons.md, "The gun": the Fire gate row fixes `FIRE_INTERVAL_TICKS`
// (`22`) whole ticks between shots, and the paragraph under the table states the
// consequence this item reads — "a held key tops out at
// `TICK_HZ / FIRE_INTERVAL_TICKS` shots per second of game time", which at
// `TICK_HZ` (`120`) is `5.45`. specs/controls.md is what makes a held key fire at
// all: "One press takes one shot; holding the key takes a shot at the gun's own
// gate."
//
// WHAT IS COUNTED. The rounds the gun adds over exactly one second of game time —
// a hundred and twenty ticks — with the fire key held down from the first of them
// and the gate open at the start. The count is taken tick by tick, off the roster
// itself, so what is measured is shots the gun really took rather than a cooldown
// the build reports.
//
// AND WHY THE ROSTER IS EMPTIED AFTER EVERY TICK THAT ADDS ONE. Because the gun
// carries a second rule that would otherwise decide this reading instead of the
// gate: `MAX_BULLETS` (`4`) rounds in flight at once, each living `BULLET_LIFE`
// (`1.5` s). Held for a second, a conforming gun's fifth and sixth requests would
// be refused by the CAP, not by the gate, and a check that counted the roster
// would report four whatever the interval was — measuring the cap while claiming
// to measure the rate. Clearing the ship's rounds each tick takes the cap out of
// the reading and leaves the gate alone; it touches nothing but the rounds this
// item is about, and specs/instrumentation.md is explicit that `clearBullets`
// leaves every other roster standing.
//
// THE BOUND IS ONE SHOT EITHER SIDE, which is the review item's figure and the
// least a whole-tick gate can be read to. A hundred and twenty ticks do not
// divide by twenty-two, so a conforming build takes five or six depending on
// where in the tick it runs its gate down, and both are inside the bound. A build
// with no gate at all takes a hundred and twenty; one gating on `FIRE_INTERVAL`
// SECONDS rather than ticks takes one; one gating every ten ticks takes twelve;
// one gating every forty-four takes three. Every one of those is outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { FIRE_INTERVAL_TICKS, KEY_FIRE, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the ship is posed, and which way it faces: along the field's bottom lane. */
const LANE_Y = 690;
const SHIP_X = 200;
const FACING = 0;

/** The window the shots are counted over: one second of game time. */
const WINDOW_TICKS = ticksFor(1);

/** The shots `specs/weapons.md` says that window holds. */
const DUE = TICK_HZ / FIRE_INTERVAL_TICKS;

/** How far the count may fall from that: one shot, the review item's figure. */
const TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes 120 / FIRE_INTERVAL_TICKS shots over a second of held fire", async () => {
  await startPlaying(h);
  await h.debug.setShipPosition(SHIP_X, LANE_Y);
  await h.debug.setShipVelocity(0, 0);
  await h.debug.setShipAngle(FACING);
  await h.debug.setFireCooldown(0);

  let shots = 0;
  await h.hold(KEY_FIRE);
  try {
    for (let tick = 1; tick <= WINDOW_TICKS; tick += 1) {
      await h.advance(1);
      const now = await h.snapshot();
      shots += now.bullets.length;
      // Every tick but the last, so the picture kept below still holds a round.
      if (now.bullets.length > 0 && tick < WINDOW_TICKS) {
        await h.debug.clearBullets();
      }
    }
  } finally {
    await h.release(KEY_FIRE);
  }
  // A second of held fire.
  await captureStill(h, "salvo");

  assertBetween(
    shots,
    DUE - TOLERANCE,
    DUE + TOLERANCE,
    `rounds added over ${WINDOW_TICKS} ticks (one second of game time) with ` +
      `the fire key held, against the TICK_HZ / FIRE_INTERVAL_TICKS = ` +
      `${DUE.toFixed(2)} that a gate of ${FIRE_INTERVAL_TICKS} whole ticks ` +
      `allows (specs/weapons.md)`,
  );
});
