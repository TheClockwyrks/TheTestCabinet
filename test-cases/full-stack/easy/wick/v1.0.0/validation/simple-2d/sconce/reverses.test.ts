// Wick — sconce/reverses: the sconce's velocity along its launch direction is
// still outward one tick before speed / SCONCE_DECEL seconds of motion, zero
// on that tick, and inward one tick after.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Sconce"): "It reverses once `speed / SCONCE_DECEL`
//     seconds of motion have passed", with `SCONCE_DECEL` (`600`) and the
//     level-1 row's speed `600`, so the reversal falls at `1` second of
//     motion, `TICK_HZ` (`60`) moving ticks.
//   - `specs/weapons.md` ("Sconce"): "after `n` moving ticks its velocity is
//     `(speed − SCONCE_DECEL × n × TICK_DT) × d`", which is `10 × d` after 59
//     moving ticks, `0` after 60, and `-10 × d` after 61.
//   - `specs/weapons.md` ("The nearest enemy"): a moth at `(300, 400)` from
//     the center gives `d` `(0.6, 0.8)`.
//   - `specs/world.md` ("One tick"), phase 6: a new projectile is "first
//     moving on the next tick", and "the sconces decelerate" while
//     `effectMotion` is on, so the ticks counted here begin the tick after the
//     firing tick.
//
// WHAT IS READ. The velocity's component along `d`, the reading the
// specification states the reversal in, after each of 61 moving ticks: it is
// above zero on the 59th, zero on the 60th, and below zero on the 61st. Only
// the sign is asserted at the two flanking ticks, since the figures they carry
// are the deceleration law's and belong to the point about that law; what this
// point fixes is the tick the sconce turns on. A build that never turns, turns
// at a fixed distance instead of a fixed time, or turns early or late fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Sconce alone at level 1, whose
// row has amount `1`, so one sconce is watched. The firing tick runs with
// `effectMotion` off; then `weaponFire` goes off, so nothing fires again while
// the flight is watched, and `effectMotion` comes on, the faculty the
// deceleration runs under. `enemyMotion` stays off, so the moth holds `500`
// units out, beyond the `305` units this sconce reaches, and the flight hits
// nothing. A level-1 sconce lives `2.5` seconds, 150 ticks, so all 61 ticks
// fall well inside its life.
//
// TOLERANCE. `MOTION_TOLERANCE` on the component at the turning tick, a figure
// a build reaches by adding the acceleration times `TICK_DT` sixty times over;
// the two flanking readings carry `10` and `-10`, four orders above that
// tolerance, so their signs are read directly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLessThan,
  assertWithin,
  fail,
} from "../assert";
import { MOTION_TOLERANCE, SCONCE_DECEL, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  projectileById,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { AIM, beginFlight, launchOne, sconceRow } from "./boomerang";

/** The speed the level-1 row states a sconce leaves at: `600`. */
const SPEED = sconceRow(1).speed;

/** The moving tick the reversal falls on: `round(600 / 600 × 60)`, 60. */
const TURN_TICK = ticksFor(SPEED / SCONCE_DECEL);

/** The moving ticks watched: through the tick after the turn. */
const FLIGHT_TICKS = TURN_TICK + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries the sconce outward on its 59th moving tick, still on its 60th, and inward on its 61st", async () => {
  const launch = await launchOne(h);
  beginFlight(h);

  const flight = await captureReplay(h, "reversal", () =>
    h.trace(FLIGHT_TICKS),
  );

  /** The velocity's component along `d` after moving tick `n`. */
  const alongOn = (n: number): number => {
    const seen: WickSnapshot | undefined = flight[n - 1];
    const sconce =
      seen === undefined ? undefined : projectileById(seen, launch.sconce.id);
    if (sconce === undefined) fail(`the sconce after moving tick ${n}`, "gone");
    return sconce.vx * AIM.x + sconce.vy * AIM.y;
  };

  assertGreaterThan(
    alongOn(TURN_TICK - 1),
    0,
    `the velocity along d after moving tick ${TURN_TICK - 1}`,
  );
  assertWithin(
    alongOn(TURN_TICK),
    0,
    MOTION_TOLERANCE,
    `the velocity along d after moving tick ${TURN_TICK}`,
  );
  assertLessThan(
    alongOn(TURN_TICK + 1),
    0,
    `the velocity along d after moving tick ${TURN_TICK + 1}`,
  );
});
