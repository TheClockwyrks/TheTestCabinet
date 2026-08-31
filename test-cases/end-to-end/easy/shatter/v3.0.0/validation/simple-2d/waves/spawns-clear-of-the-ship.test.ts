// waves/spawns-clear-of-the-ship — a wave spawns clear of the ship.
//
// `specs/progression.md`, Waves: each Large rock "is placed at a random position
// at least `WAVE_MIN_SHIP_DIST` (`300`) from the ship and at least
// `WAVE_MIN_STAR_DIST` (`200`) from the star, both by the shortest wrapped
// separation". This item reads the first of those two; `spawns-clear-of-the-star`
// reads the second, so a build that respects one and not the other loses one point
// rather than two.
//
// THE SHIP IS NOT LEFT WHERE A RESPAWN PUTS IT. `startPlaying` leaves it at the
// safe point `(640, 560)`, which is also where `specs/progression.md` puts a new
// ship — so a build that keeps its waves clear of THE SAFE POINT rather than of the
// ship reads identically there, and the item would be graded by a coincidence.
// The ship is therefore flown out to `(300, 180)` before the wave is called for,
// and the clearance is measured against wherever the snapshot says the ship
// actually is on the tick the rocks arrive. That position leaves the specification
// satisfiable with room to spare: the two exclusions cover about two fifths of the
// field between them.
//
// AND IT IS MEASURED AT THE ARRIVAL, out of the same snapshot as the rocks. The
// ship is posed at rest and left alone, and `specs/ship.md` puts it outside the
// well entirely — "the star never pulls the ship" — so it is still exactly there
// when the wave arrives; reading it live rather than from the pose is what keeps
// the check honest against a build that moves it anyway.
//
// TEN SEEDS, BECAUSE THE PLACEMENT IS A DRAW. `specs/simulation.md` lists a wave's
// rock positions among the game's seeded draws, so one wave is one sample of a
// random layout: a build that places rocks anywhere at all satisfies the rule on
// some waves by luck. Ten games at wave 10 is a hundred and thirty independent
// placements, and the verdict is the CLOSEST of all of them — one rock inside the
// exclusion on any of the ten fails the item, and names which.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_SPEED_MAX,
  TICK_DT,
  WAVE_MIN_SHIP_DIST,
} from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  arrivedWave,
  describeRock,
  poseLiveWave,
  shipClearance,
  shootTheFieldClear,
  waveSpeedScale,
} from "./scenario";

/**
 * Where the ship is flown to before the wave is called for.
 *
 * Nowhere near the safe point, so a build that clears its waves of the safe point
 * rather than of the ship fails; `385` units from the star, so the star's core is
 * nowhere near it and the two exclusions still leave three fifths of the field for
 * the spawner to place into.
 */
const SHIP_AT = { x: 300, y: 180 };

/** The wave the run is posed at, and the one that arrives when it is cleared. */
const POSED_WAVE = 9;
const ARRIVING_WAVE = POSED_WAVE + 1;

/** The seeds the placement is sampled on. `specs/simulation.md` seeds the draw. */
const SEEDS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/**
 * How far inside the stated clearance a rock may read: two logical units.
 *
 * Not slack in the rule — it is the cost of reading a moving field one tick late.
 * A build is free to spawn its rocks and then step them within the same tick, and
 * `specs/simulation.md` moves every body once a tick: wave 10's Large rocks drift
 * at up to `ROCK_SPEED_MAX.large` scaled by `waveSpeedScale(10)`, which is under
 * one and a third units in a tick. The ship adds nothing to that — it is at rest
 * and outside the well. Two units covers the rock with room over, and is a
 * fiftieth of the three hundred the specification asks for: far too small to hide
 * a build that places a rock on the ship's doorstep.
 */
const READING_SLACK = 2;

/** The floor a rock's clearance is held to. */
const FLOOR = WAVE_MIN_SHIP_DIST - READING_SLACK;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spawns every rock of a wave at least 300 from the ship", async () => {
  // Named so the failure below can say which of the ten games it came from, and
  // so the reading is the closest approach of all of them rather than the last.
  let closest = { seed: -1, distance: Number.POSITIVE_INFINITY, what: "" };

  for (const seed of SEEDS) {
    h.debug.reset({ seed });
    poseLiveWave(h, { wave: POSED_WAVE });
    // Before the clear, not after it: the ship is out here for the whole of the
    // banner as well as for the tick the wave turned over, so a build that fixes
    // its placements when the wave clears and one that fixes them as the banner
    // ends are both measured against a ship that is nowhere near the safe point.
    h.debug.setShipPosition(SHIP_AT.x, SHIP_AT.y);
    h.debug.setShipVelocity(0, 0);
    const cleared = await shootTheFieldClear(h);
    const arrival = await arrivedWave(h, cleared);

    for (const rock of arrival.rocks) {
      const distance = shipClearance(arrival, rock);
      if (distance < closest.distance) {
        closest = {
          seed,
          distance,
          what:
            `${describeRock(rock)}, with the ship at ` +
            `(${arrival.ship.x.toFixed(1)}, ${arrival.ship.y.toFixed(1)})`,
        };
      }
    }
  }
  captureStill(h, "wave");

  assertGreaterThanOrEqual(
    closest.distance,
    FLOOR,
    `the shortest wrapped separation from the ship of the closest rock of ` +
      `${SEEDS.length} wave-${ARRIVING_WAVE} spawns, which ` +
      `specs/progression.md puts at WAVE_MIN_SHIP_DIST ` +
      `(${WAVE_MIN_SHIP_DIST}); the closest was ${closest.what} on seed ` +
      `${closest.seed}`,
  );
});

// A self-check on the POSE rather than on any build, run at import so a figure
// this item rests on going stale is a broken suite rather than a verdict reached in
// the dark. The slack above is only worth what it is worth if it really does cover
// one tick of the fastest rock this wave can hold.
{
  const perTick =
    ROCK_SPEED_MAX.large * waveSpeedScale(ARRIVING_WAVE) * TICK_DT;
  if (perTick >= READING_SLACK) {
    throw new Error(
      `waves/spawns-clear-of-the-ship: a wave-${ARRIVING_WAVE} Large travels ` +
        `${perTick} units in a tick, which the ${READING_SLACK}-unit reading ` +
        `slack no longer covers (specs/rocks.md, specs/progression.md)`,
    );
  }
}
