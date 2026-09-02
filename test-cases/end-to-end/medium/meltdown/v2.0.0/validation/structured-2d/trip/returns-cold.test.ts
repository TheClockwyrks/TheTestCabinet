// Meltdown — trip/returns-cold: it comes back online cold.
//
// specs/heat.md, The trip: "When the cooldown reaches `0` the emitter is online
// again, at heat `0`." Two things, and the second is the one that costs the
// player something: the trip does not merely park a tower for five seconds, it
// takes the tower's whole heat with it, so what comes back is a gun at
// `MIN_HEAT_MULT` (`0.35`) damage that has to climb the curve all over again. A
// build that returns the tower to the heat it tripped at has removed the trip's
// price and left the game with no risk in it.
//
// THE TWO HALVES HAVE TO BE POSED APART, because at the end of a full cooldown
// they coincide. A tower tripping at `100` bleeds at `TRIP_HEAT / TRIP_TIME`, so
// after `TRIP_TIME` seconds its heat has reached `0` on the way down whether or
// not the return zeroes anything. So:
//
//   THE FULL COOLDOWN — the case the point is named for — poses a tower tripped
//   at `100` with the whole `TRIP_TIME` in front of it, and reads it once the
//   cooldown is spent: online, and cold.
//
//   THE SHORT COOLDOWN poses the same tower with `setTowerTripTimer` at one
//   second. specs/instrumentation.md has that operation set "the seconds left on
//   the trip cooldown ... that field alone", so the tower stands tripped at `100`
//   with a second to run; the bleed takes `20` of it, and the cooldown reaches
//   `0` with `80` still on the tower. The specification returns it at heat `0`
//   all the same. A build that lets the returning tower keep whatever the bleed
//   left reads `80` here, where the full cooldown could not tell it apart from a
//   conforming one.
//
// THE TRIP IS POSED, NOT MANUFACTURED. `poseTrippedTower` sets the tripped flag,
// the cooldown and the heat directly, so this item decides the RETURN alone and
// depends on nothing about targeting, range or the fire clock; reaching the trip
// in the first place is `trips-at-100`'s single requirement.
//
// TWO FRAMES PAST EACH COOLDOWN. specs/heat.md returns the tower when the
// cooldown reaches `0`, and a build is free to resolve that on the frame that
// crosses it or on the one after; two frames is `0.017` s. Nothing else moves a
// lone tower at heat `0` in them — air cooling is proportional to heat, and with
// an empty floor in front of it there is nothing to fire at — so the `0` this
// asserts is the return's own.

import { afterEach, beforeEach, it } from "vitest";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTrippedTower,
  seconds,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { freeSite, towerOf } from "./bench";

/** The emitter taken offline, and the heat the trip left it at. */
const TOWER = "arc";
const TRIPPED_AT = TRIP_HEAT;

/**
 * The two cooldowns the return is read at: the one a trip carries, and a short
 * one that ends while the bleed still has heat left to take (see the head).
 */
const SHORT_COOLDOWN = 1.0;
const COOLDOWNS = [TRIP_TIME, SHORT_COOLDOWN];

/** Frames past the end of each cooldown the reading is taken (see the head). */
const RETURN_SLACK_FRAMES = 2;

/**
 * How much heat the tower may carry and still be cold.
 *
 * One frame of the `TRIP_HEAT / TRIP_TIME` bleed, which is `20 / 120`, so a build
 * that resolves the return one frame either side of the crossing is not held to
 * the frame it chose. What the bound excludes is a tower that comes back at the
 * heat it tripped at, or at whatever the bleed happened to leave on it.
 */
const COLD_CEILING = (TRIP_HEAT / TRIP_TIME) * seconds(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("It comes back online cold", async () => {
  for (const [index, cooldown] of COOLDOWNS.entries()) {
    startRun(h);
    const at = freeSite(index);
    const id = poseTrippedTower(h, TOWER, at.col, at.row, TRIPPED_AT, cooldown);

    await h.advance(ticksFor(cooldown) + RETURN_SLACK_FRAMES);
    if (cooldown === TRIP_TIME) captureStill(h, "returned");

    const tower = towerOf(h.snapshot(), id);
    assertEqual(
      tower.tripped,
      false,
      `whether a ${TOWER} tripped at ${TRIPPED_AT} is still tripped ` +
        `${cooldown}s later, with a ${cooldown}s cooldown on it`,
    );
    assertBetween(
      tower.heat,
      0,
      COLD_CEILING,
      `the heat a ${TOWER} tripped at ${TRIPPED_AT} comes back online at ` +
        `once its ${cooldown}s cooldown is spent`,
    );
  }
});
