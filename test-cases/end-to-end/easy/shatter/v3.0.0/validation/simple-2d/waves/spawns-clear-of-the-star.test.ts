// waves/spawns-clear-of-the-star — a wave spawns clear of the star.
//
// `specs/progression.md`, Waves: each Large rock "is placed at a position drawn
// uniformly from the points of the field at least `WAVE_MIN_SHIP_DIST` (`300`)
// from the ship and at least `WAVE_MIN_STAR_DIST` (`200`) from the star, both by
// the shortest wrapped separation". This item reads the second of those two; `spawns-clear-of-the-ship`
// reads the first, so a build that respects one and not the other loses one point
// rather than two.
//
// WHY THE RULE IS THERE AND WHY IT IS WORTH A POINT OF ITS OWN. The star is the one
// physical boundary on the field (`specs/field.md`): a rock that reaches its core
// is recycled to an edge (`specs/rocks.md`). A build that spawns rocks on top of
// the well hands the player a wave that has already begun to fall in, and the two
// hundred units is what stops that.
//
// THE STAR NEVER MOVES, so unlike the ship there is nothing to pose:
// `specs/field.md` fixes it at `(STAR_X, STAR_Y)` for the whole game, and the
// clearance is measured against that. What the check must be careful about instead
// is WHEN it reads — a rock spawned at exactly two hundred units is falling toward
// the star from the tick it exists, so the reading is taken on the first tick the
// roster is not empty and carries one tick of travel as its only slack.
//
// ONE WAVE, EVERY ROCK OF IT. `specs/simulation.md` lists a wave's rock positions
// among the draws the game makes, and the rule is a bound on each draw rather
// than a statistic over many: every rock of the wave that arrives is held to the
// clearance, and the verdict is the CLOSEST of them. Wave 10 puts thirteen of
// them up, a handful of unposed draws against the bound, and a build with no
// star exclusion at all has the exclusion's share of the field to land in on
// each. How a build's placements are shaped inside the rule is the reviewer's to
// judge; nothing poses a position, and the placement is the build's own draw,
// read where it lands.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_SPEED_MAX, TICK_DT, WAVE_MIN_STAR_DIST } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  STAR_AT,
  arrivedWave,
  clearAWave,
  describeRock,
  starClearance,
  waveSpeedScale,
} from "./scenario";

/** The wave the run is posed at, and the one that arrives when it is cleared. */
const POSED_WAVE = 9;
const ARRIVING_WAVE = POSED_WAVE + 1;

/**
 * How far inside the stated clearance a rock may read: two logical units.
 *
 * Not slack in the rule — it is the cost of reading a moving field one tick late.
 * A build is free to spawn its rocks and then step them within the same tick, and
 * `specs/simulation.md` moves every body once a tick: wave 10's Large rocks drift
 * at up to `ROCK_SPEED_MAX.large` scaled by `waveSpeedScale(10)`, which is under
 * one and a third units in a tick, and `specs/gravity.md`'s well adds well under a
 * unit of travel over the same tick at two hundred units out. Two units covers
 * both, and is a hundredth of the two hundred the specification asks for — far too
 * small to hide a build that spawns a rock on the well.
 */
const READING_SLACK = 2;

/** The floor a rock's clearance is held to. */
const FLOOR = WAVE_MIN_STAR_DIST - READING_SLACK;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spawns every rock of a wave at least 200 from the star", async () => {
  let closest = { distance: Number.POSITIVE_INFINITY, what: "" };

  h.debug.reset();
  const cleared = await clearAWave(h, { wave: POSED_WAVE });
  const arrival = await arrivedWave(h, cleared);
  captureStill(h, "wave");

  for (const rock of arrival.rocks) {
    const distance = starClearance(rock);
    if (distance < closest.distance) {
      closest = { distance, what: describeRock(rock) };
    }
  }

  assertGreaterThanOrEqual(
    closest.distance,
    FLOOR,
    `the shortest wrapped separation from the star at ${STAR_AT} of the ` +
      `closest rock of the wave-${ARRIVING_WAVE} spawn, which ` +
      `specs/progression.md puts at WAVE_MIN_STAR_DIST ` +
      `(${WAVE_MIN_STAR_DIST}); the closest was ${closest.what}`,
  );
});

// A self-check on the POSE rather than on any build, run at import so a figure this
// item rests on going stale is a broken suite rather than a verdict reached in the
// dark.
{
  const perTick =
    ROCK_SPEED_MAX.large * waveSpeedScale(ARRIVING_WAVE) * TICK_DT;
  if (perTick >= READING_SLACK) {
    throw new Error(
      `waves/spawns-clear-of-the-star: a wave-${ARRIVING_WAVE} Large travels ` +
        `${perTick} units in a tick, which the ${READING_SLACK}-unit reading ` +
        `slack no longer covers (specs/rocks.md, specs/progression.md)`,
    );
  }
}
