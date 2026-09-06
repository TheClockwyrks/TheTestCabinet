// waves/spawns-clear-of-the-ship — a wave never lands on top of the ship.
//
// THE RULE. `specs/progression.md`, "Waves": each rock of a wave "is placed at a
// position drawn uniformly from the points of the field at least
// `WAVE_MIN_SHIP_DIST` (`300`) from the ship and at least `WAVE_MIN_STAR_DIST`
// (`200`) from the star, both by the shortest wrapped separation". `specs/field.md` defines that separation.
//
// WHAT IS MEASURED. The shortest WRAPPED distance from each arriving rock's centre
// to the ship's, over every rock of several waves, against `300`. The ship's
// clearance alone: the star's is `spawns-clear-of-the-star`'s point, and a build
// that keeps its waves off the star and drops one on the ship loses this point and
// not that one.
//
// THE SHIP IS POSED OFF THE SAFE POINT, and that is the sharpest thing about this
// check. `startPlaying` leaves the ship at `(SAFE_X, SAFE_Y)` = `(640, 560)`, which
// is where a build that measures its clearance from a CONSTANT rather than from the
// ship would also be right. Posed at `(180, 140)` — the far corner from the safe
// point, and `540` units from the star so the ship is not itself inside the star's
// own exclusion — a build measuring from the safe point puts rocks in the corner
// the ship is actually standing in, and this reads them.
//
// AND WHY THE READING IS WRAPPED. `specs/field.md` makes the field a torus and
// says every rule that measures a distance between two bodies measures it across
// the seams. A build that measures its clearance with a plain Cartesian distance
// is free to place a rock at `(1200, 700)`, which is `1020` units from a ship at
// `(180, 140)` the long way round and `130` across the seams — right on top of it.
// That build passes a Cartesian check and fails this one.
//
// WHY THE SWEEP IS AS LARGE AS IT IS. The positions are DRAWN
// (`specs/simulation.md`, "Random draws"), so this is a containment check
// over draws and what decides it is how much of the field a build with a smaller
// exclusion leaves open. The annulus between `250` and `300` is nine percent of
// the field, so a build that excludes `250` escapes one draw with probability
// `0.91` and the `276` draws below with a probability of about one in ten
// million. It is also enough that a build which satisfies the rule by rejecting
// and redrawing, and gives up after a fixed number of tries, shows up rather than
// being graded by luck. Nothing poses a position: the placement is the build's own
// draw, read where it lands.
//
// THE TOLERANCE IS ONE TICK OF DRIFT. The rocks are read on the first tick they
// are on the field, but whether a build spawned them before or after that tick's
// motion step is its own business (`specs/simulation.md` fixes the order of the
// six steps in a tick and says nothing about where a spawn sits among them). A
// Large drifts at up to `110` units per second (`specs/rocks.md`) scaled by at
// most `1 + WAVE_SPEED_CAP`, so one tick moves it by at most `1.29` units. That is
// the whole of the allowance, and it is room for the tick rather than room on the
// figure.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_SPEED_MAX,
  TICK_DT,
  WAVE_MIN_SHIP_DIST,
  WAVE_SPEED_CAP,
} from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import { wrappedDistance } from "../geometry";
import { captureStill, createHarness, type Harness } from "../harness";
import { clearTheWave, openWaveAt, waitForTheWave } from "./scene";

/** The wave the field is posed at, so the wave that arrives holds 23 rocks. */
const WAVE = 19;

/**
 * How many games the wave is spawned in.
 *
 * Twelve waves of twenty-three rocks is `276` independent draws put through the
 * rule. See the header for what that buys.
 */
const GAMES = 12;

/**
 * Where the ship stands: the far corner from the safe point, and `540` units from
 * the star so it is nowhere near the star's own exclusion zone.
 */
const SHIP_X = 180;
const SHIP_Y = 140;

/**
 * How far short of `WAVE_MIN_SHIP_DIST` a reading may fall, in units.
 *
 * One tick of the fastest drift a wave can carry: `ROCK_SPEED_MAX.large` (`110`)
 * scaled by `1 + WAVE_SPEED_CAP` (`1.4`) is `154` units per second, which is
 * `1.29` units over one `TICK_DT`. That covers a build whose spawn sits before its
 * motion step and nothing else.
 */
const DRIFT_TOLERANCE = ROCK_SPEED_MAX.large * (1 + WAVE_SPEED_CAP) * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("places every rock of a wave WAVE_MIN_SHIP_DIST from the ship", async () => {
  let closest = Number.POSITIVE_INFINITY;
  let closestAt = "";

  for (let game = 1; game <= GAMES; game += 1) {
    openWaveAt(h, WAVE);
    h.debug.setShipPosition(SHIP_X, SHIP_Y);
    await clearTheWave(h);
    const arrival = await waitForTheWave(h);
    // The wave standing clear of the ship.
    captureStill(h, "wave");

    const ship = arrival.at.ship;
    for (const rock of arrival.rocks) {
      const distance = wrappedDistance(rock, ship);
      if (distance < closest) {
        closest = distance;
        closestAt =
          `game ${String(game)}, rock at ` +
          `(${rock.x.toFixed(1)}, ${rock.y.toFixed(1)}) with the ship at ` +
          `(${ship.x.toFixed(1)}, ${ship.y.toFixed(1)})`;
      }
    }
  }

  assertGreaterThanOrEqual(
    closest,
    WAVE_MIN_SHIP_DIST - DRIFT_TOLERANCE,
    `every rock of a spawned wave at least WAVE_MIN_SHIP_DIST ` +
      `(${String(WAVE_MIN_SHIP_DIST)}) from the ship by the shortest WRAPPED ` +
      `separation (specs/progression.md, specs/field.md), less ` +
      `${DRIFT_TOLERANCE.toFixed(2)} for one tick of the fastest drift a wave ` +
      `can carry; the ship was posed away from the safe point, so a build ` +
      `measuring from (SAFE_X, SAFE_Y) rather than from the ship reads here; ` +
      `closest of ${String(GAMES)} waves: ${closestAt}`,
  );
});
