// torpedo/recharge-is-linear — the charge climbs at a steady rate.
//
// specs/weapons.md, "The charge": the charge "rises linearly from `0` to `1` over
// `TORPEDO_RECHARGE` (`10` seconds) of game time, so it reads `0.5` at five
// seconds and `0.25` at two and a half". That sentence is what makes the SHAPE of
// the refill a rule rather than the build's choice: without it an ease-in curve, a
// refill that does nothing for nine seconds and then fills, or a stepped one that
// jumps a quarter every two and a half seconds would all be conformant, and all of
// them reach `1` at ten seconds. `recharges-in-ten-seconds` decides the duration;
// this decides the climb.
//
// TWO STATIONS, AND EACH RULES OUT A DIFFERENT WRONG SHAPE. At a quarter of the
// way the linear rule reads `0.25`: an ease-in curve reads below it and an ease-out
// above. At half way it reads `0.5`: a stepped refill that has just taken its
// second step reads `0.5` there but read `0.25` at neither station a step falls
// on, so the pair catches it. Both are the specification's own worked figures.
//
// THE STATIONS ARE MEASURED FROM THE LAUNCH, in ticks of the `TICK_HZ` (`120`)
// clock specs/simulation.md fixes, so the two and a half and five seconds are game
// time rather than wall clock — which is the only clock the sentence can mean,
// since the game advances in whole ticks and this harness drives them.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { TORPEDO_RECHARGE } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { chargeOf, poseShip, pressTorpedo, theTorpedo } from "./scene";

/** The two stations, as fractions of the refill: a quarter of the way, and half. */
const STATIONS = [0.25, 0.5] as const;

/**
 * How far a station's reading may sit from the linear value, in charge units.
 *
 * The manifest's own allowance: `0.03` of the `0` to `1` range, which is three
 * tenths of a second of climb. It covers the tick the launch itself fell on and
 * nothing more; the wrong shapes this item exists to catch are out by tenths.
 */
const TOLERANCE = 0.03;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads a quarter charged at two and a half seconds and half charged at five", async () => {
  await startPlaying(h);
  await poseShip(h);

  const fired = await pressTorpedo(h);
  // Hard first: a press that launched nothing spent no charge to climb from.
  theTorpedo(fired, "the launch whose refill is being sampled");

  let elapsed = 0;
  const readings: number[] = [];
  for (const station of STATIONS) {
    const at = station * TORPEDO_RECHARGE;
    await h.skip(ticksFor(at) - elapsed);
    elapsed = ticksFor(at);
    readings.push(
      chargeOf(await h.snapshot(), `${at} seconds into the refill`),
    );
  }
  // The charge half full, five seconds into the refill.
  await captureStill(h, "halfway");

  STATIONS.forEach((station, index) => {
    assertLessThanOrEqual(
      Math.abs(readings[index] - station),
      TOLERANCE,
      `the charge ${station * TORPEDO_RECHARGE} seconds after a launch, which ` +
        `a refill rising linearly from 0 to 1 over TORPEDO_RECHARGE ` +
        `(${TORPEDO_RECHARGE} s) puts at ${station} (specs/weapons.md); it ` +
        `read ${readings[index]}`,
    );
  });
});
