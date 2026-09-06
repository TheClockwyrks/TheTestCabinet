// waves/spawns-clear-of-the-star — a wave never lands on top of the star.
//
// THE RULE. `specs/progression.md`, "Waves": each rock of a wave "is placed at a
// random position at least `WAVE_MIN_SHIP_DIST` (`300`) from the ship and at least
// `WAVE_MIN_STAR_DIST` (`200`) from the star, both by the shortest wrapped
// separation". The star stands at `(STAR_X, STAR_Y)` = `(640, 360)`
// (`specs/field.md`).
//
// WHAT IS MEASURED. The shortest wrapped distance from each arriving rock's centre
// to `(STAR_X, STAR_Y)`, over every rock of several waves, against `200`. The
// star's clearance alone: the ship's is `spawns-clear-of-the-ship`'s point.
//
// WHY THE RULE EXISTS AND WHY THE FIGURE IS THE ONE IT IS. `specs/gravity.md` puts
// the well's acceleration at `112.5` units per second squared at `d = 200` and
// caps it at `555.6` inside `SOFTEN` (`90`), and `specs/collision.md` has the core
// recycle a rock that reaches it. A wave spawned inside the exclusion is a wave
// half of which falls straight into the star; `200` is where the specification
// draws the line, and this item is whether the build drew it there too.
//
// WHY THE SWEEP IS AS LARGE AS IT IS. This is a CONTAINMENT check over drawn
// positions, so what decides it is how much of the field a build with a smaller
// exclusion leaves open and how many draws are put through it. The annulus between
// `150` and `200` is six percent of the field, so a build that excludes `150`
// escapes one draw with probability `0.94`; over the `276` draws below it escapes
// with probability under one in ten thousand. A sweep an order smaller lets that
// build through about one time in fifty, which is not a check. The resolution the
// sweep buys is roughly this: a build out by a quarter is caught every time, and
// one out by five percent — the annulus between `190` and `200`, one and a third
// percent of the field — is caught about forty times in forty-one.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build with no star
// exclusion at all spawns uniformly over the field, where the expected closest of
// this many draws is a handful of units from the centre. A build that excludes
// only the CORE
// (`CORE_R`, `30`) or only the drawn halo (`180`, `specs/field.md`) reads a
// closest approach near those figures. A build that measures from the field's
// centre by a Cartesian distance rather than a wrapped one agrees with this check
// exactly, because the star stands at the centre and the two readings coincide
// there — which is why the wrapped reading is load-bearing in
// `spawns-clear-of-the-ship` and merely correct here.
//
// THE SHIP IS LEFT AT THE SAFE POINT, because it is not what this item measures
// and moving it would only change which draws a build's own rejection loop
// discards. Nothing poses a position: the placement is the build's own draw, read
// where it lands.
//
// THE TOLERANCE IS ONE TICK OF DRIFT, on the same derivation
// `spawns-clear-of-the-ship` gives.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_SPEED_MAX,
  TICK_DT,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
} from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import { STAR, wrappedDistance } from "../geometry";
import { captureStill, createHarness, type Harness } from "../harness";
import { clearTheWave, openWaveAt, waitForTheWave } from "./scene";

/** The wave the field is posed at, so the wave that arrives holds 23 rocks. */
const WAVE = 19;

/**
 * How many games the wave is spawned in.
 *
 * Twelve waves of twenty-three rocks is `276` independent draws put through the
 * rule, and the number is chosen from what a build with a SMALLER exclusion would
 * have to survive. A build that excludes `150` rather than `200` leaves the
 * annulus between the two open, which is six percent of the field, so it escapes
 * a single draw with probability `0.94` and a whole sweep of this size with
 * probability under one in ten thousand. Five waves — sixty-five draws — let it
 * through about one time in fifty, which is not a check.
 */
const GAMES = 12;

/**
 * How far short of `WAVE_MIN_STAR_DIST` a reading may fall, in units: one tick of
 * the fastest drift a wave can carry, `ROCK_SPEED_MAX.large` (`110`) scaled by
 * `1 + WAVE_SPEED_CAP` (`1.4`).
 */
const DRIFT_TOLERANCE = ROCK_SPEED_MAX.large * (1 + WAVE_SPEED_CAP) * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("places every rock of a wave WAVE_MIN_STAR_DIST from the star", async () => {
  let closest = Number.POSITIVE_INFINITY;
  let closestAt = "";

  for (let game = 1; game <= GAMES; game += 1) {
    openWaveAt(h, WAVE);
    await clearTheWave(h);
    const arrival = await waitForTheWave(h);
    // The wave standing clear of the star.
    captureStill(h, "wave");

    for (const rock of arrival.rocks) {
      const distance = wrappedDistance(rock, STAR);
      if (distance < closest) {
        closest = distance;
        closestAt =
          `game ${String(game)}, rock at ` +
          `(${rock.x.toFixed(1)}, ${rock.y.toFixed(1)})`;
      }
    }
  }

  assertGreaterThanOrEqual(
    closest,
    WAVE_MIN_STAR_DIST - DRIFT_TOLERANCE,
    `every rock of a spawned wave at least WAVE_MIN_STAR_DIST ` +
      `(${String(WAVE_MIN_STAR_DIST)}) from the star's centre by the shortest ` +
      `wrapped separation (specs/progression.md, specs/field.md), less ` +
      `${DRIFT_TOLERANCE.toFixed(2)} for one tick of the fastest drift a wave ` +
      `can carry; closest of ${String(GAMES)} waves: ${closestAt}`,
  );
});
