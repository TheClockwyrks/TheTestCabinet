// Wick — sconce/returns-past-launch-point: the sconce comes back through the
// point the lamplighter's center held on the tick of firing, and goes beyond
// it, with the lamplighter long gone from that point.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Sconce"): "It reverses once `speed / SCONCE_DECEL`
//     seconds of motion have passed and returns past the launch point, which
//     stays where the player's center was on the tick of firing".
//   - `specs/weapons.md` ("Sconce"): "after `n` moving ticks its velocity is
//     `(speed − SCONCE_DECEL × n × TICK_DT) × d`", integrated "position first
//     and then velocity", so the displacement along `d` after `n` moving ticks
//     is the sum of those velocities at `0` through `n − 1`, each times
//     `TICK_DT`. With the level-1 row's speed `600` and `SCONCE_DECEL` (`600`)
//     that sum is zero at `2 × speed / (SCONCE_DECEL × TICK_DT) + 1`, the
//     121st moving tick, positive on the 120th, and negative on the 122nd.
//   - `specs/weapons.md` ("Sconce"), the level-1 row: duration `2.5`, and
//     `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl` is
//     set to its `duration` when it is fired ... and it is removed on the tick
//     `ttl` is due", so the sconce lives 150 moving ticks and the return falls
//     28 ticks inside that.
//   - `specs/instrumentation.md` (`setPlayerPosition`): "Sets the
//     lamplighter's center to `(x, y)`. Nothing else moves".
//
// WHAT IS READ. The sconce's displacement from the launch point along `d`,
// after each moving tick through the 122nd: above zero on the 120th, zero on
// the 121st, and below zero on the 122nd, with the sconce still alive there
// and the lamplighter standing `400` units off that point the whole time. A
// build whose sconce keeps flying outward, stops where it turned, or comes
// back to the lamplighter rather than to the launch point fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Sconce alone at level 1, whose
// row has amount `1`, so one sconce is watched. The firing tick runs with
// `effectMotion` off; then the lamplighter is set `400` units off the launch
// point along the perpendicular of `d`, so a sconce that tracked the
// lamplighter rather than the launch point could not read as a return;
// `weaponFire` goes off, so nothing fires again while the flight is watched;
// and `effectMotion` comes on, the faculty the motion runs under.
// `enemyMotion` stays off, so the moth holds `500` units out, beyond the `305`
// units this sconce reaches, and the flight hits nothing.
//
// TOLERANCE. `MOTION_TOLERANCE` on the displacement at the returning tick, a
// figure a build reaches by adding a position step 121 times over; the
// flanking readings carry `10` and `-10.17` units, seven orders above that
// tolerance, so their signs are read directly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLessThan,
  assertWithin,
  fail,
} from "../assert";
import { MOTION_TOLERANCE, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  distance,
  projectileById,
  type Harness,
  type WickSnapshot,
} from "../harness";
import {
  AIM,
  beginFlight,
  launchOne,
  returnTick,
  sconceRow,
} from "./boomerang";

/** The level-1 row, whose speed is `600` and duration `2.5`. */
const ROW = sconceRow(1);

/** The moving tick the sconce is back at its launch point on: 121. */
const RETURN_TICK = returnTick(ROW.speed);

/** The moving ticks watched: one past the return. */
const FLIGHT_TICKS = RETURN_TICK + 1;

/** How long the sconce lives, in moving ticks: `round(2.5 × 60)`, 150. */
const LIFE_TICKS = ticksFor(ROW.duration);

/** How far the lamplighter is set from the launch point once the sconce is away. */
const WALK = 400;

/** The perpendicular of `d`, the direction the lamplighter is set along. */
const ACROSS = { x: -AIM.y, y: AIM.x };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("brings the sconce back through its launch point on moving tick 121 and past it on 122", async () => {
  assertLessThan(
    FLIGHT_TICKS,
    LIFE_TICKS,
    "the moving ticks watched, against the sconce's life in ticks",
  );
  const launch = await launchOne(h);
  h.debug.setPlayerPosition(
    launch.from.x + WALK * ACROSS.x,
    launch.from.y + WALK * ACROSS.y,
  );
  beginFlight(h);

  const flight = await captureReplay(h, "return", () => h.trace(FLIGHT_TICKS));

  /** The displacement from the launch point along `d` after moving tick `n`. */
  const alongOn = (n: number): number => {
    const seen: WickSnapshot | undefined = flight[n - 1];
    const sconce =
      seen === undefined ? undefined : projectileById(seen, launch.sconce.id);
    if (sconce === undefined) fail(`the sconce after moving tick ${n}`, "gone");
    return (
      (sconce.x - launch.from.x) * AIM.x + (sconce.y - launch.from.y) * AIM.y
    );
  };

  assertGreaterThan(
    alongOn(RETURN_TICK - 1),
    0,
    `the displacement along d after moving tick ${RETURN_TICK - 1}`,
  );
  assertWithin(
    alongOn(RETURN_TICK),
    0,
    MOTION_TOLERANCE,
    `the displacement along d after moving tick ${RETURN_TICK}`,
  );
  assertLessThan(
    alongOn(RETURN_TICK + 1),
    0,
    `the displacement along d after moving tick ${RETURN_TICK + 1}`,
  );
  assertWithin(
    distance(flight[RETURN_TICK - 1].run.player, launch.from),
    WALK,
    MOTION_TOLERANCE,
    "how far the lamplighter stands from the launch point on the returning tick",
  );
});
