// Meltdown — combat/bloom-splashes: the Bloom's shot catches the neighbours.
//
// specs/combat.md: "A Bloom's shot removes its damage from every unit whose centre
// lies within `BLOOM_SPLASH` (`2.4`) tiles of the target's centre, which is
// `2.4 * TILE` logical units. Each unit inside that radius takes the full per-shot
// damage ONCE, the target included."
//
// SO WHAT IS ASSERTED IS EQUALITY, NOT A FIGURE. The three neighbours each lose
// exactly what the target loses, and the figure they all lose is
// `combat/damage-per-shot`'s business rather than this point's. Read that way, a
// build whose per-shot damage is wrong still passes here, and what fails is a build
// that splashes for a fraction, splashes twice on the target, or does not splash at
// all.
//
// THE THREE NEIGHBOURS SIT AT THREE DIFFERENT BEARINGS: one due west at `40` units,
// and two at `42.4` on the north-west and south-west diagonals, all inside the
// `45.6`-unit radius. The diagonals are what catch a build that splashed over a
// square rather than a circle in the other direction — a chebyshev box of side `2.4`
// tiles would include them too, but a build that splashed only along the axes, or
// only to the four orthogonal TILE neighbours, misses both.
//
// EVERY NEIGHBOUR IS WEST OF THE TARGET, AND THAT IS NOT DECORATION. The emitter
// picks the in-range unit with the smallest `remaining` (specs/combat.md), and a
// unit entering the left vent is assigned the right exhaust, so a neighbour posted
// EAST of the target would be the one further along and would be targeted itself —
// making the reading a reading of a different impact point. The check states the
// precondition it needs — that the target is the one the emitter named — and grades
// the splash from there.
//
// THE MARKS CANNOT MOVE OR DIE, so the four hp readings are four subtractions over
// the same one shot: motion off, and hp far past a Bloom shot's `3.5` at heat `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { BLOOM_SPLASH, TILE } from "../constants";
import { captureReplay, createHarness, unitOf, type Harness } from "../harness";
import {
  eastOfGun,
  fireRateOf,
  poseGun,
  poseMarkAt,
  readGun,
  readHp,
  ticksForShots,
} from "./duel";

/** The only emitter with a splash (specs/towers.md), and its pinned heat. */
const TOWER = "bloom";
const HEAT = 0;

/** specs/combat.md and specs/floor.md: 2.4 tiles of 19 units, so 45.6. */
const SPLASH_UNITS = BLOOM_SPLASH * TILE;

/**
 * How far out the target stands: four tiles from the footprint centre.
 *
 * Geometry, not a tolerance. `76` units puts the whole splash arrangement clear of
 * the 3x3 footprint, so no neighbour is posed on a tile a tower covers, and it
 * leaves two tiles of room inside the Bloom's `114` — enough that a build whose
 * range is measured from the wrong point still fires, and is graded for that by
 * `combat/range-from-the-footprint-centre` rather than here.
 */
const TARGET_UNITS = 76;

const TARGET = eastOfGun(TOWER, TARGET_UNITS);

/**
 * Where the three neighbours stand, relative to the target's centre: due west, and
 * on the two western diagonals.
 *
 * All three are inside `45.6` — `40` and `42.43` — and all three are west of the
 * target, so the target keeps the smallest `remaining` and stays the one the
 * emitter fires on.
 */
const NEIGHBOURS: readonly { name: string; dx: number; dy: number }[] = [
  { name: "west", dx: -40, dy: 0 },
  { name: "north-west", dx: -30, dy: -30 },
  { name: "south-west", dx: -30, dy: 30 },
];

/**
 * How close each neighbour's loss must come to the target's, as decimal places of a
 * hit point.
 *
 * Three places is `0.0005` hp. Both sides of the comparison are the same product a
 * build computed once, so a conformant build's two subtractions differ by nothing at
 * all; the bound is there to exclude a splash that is a fixed fraction of the shot —
 * the nearest such reading, half damage, is `1.75` hp away at the heat posed.
 */
const EQUAL_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Bloom splashes its target's neighbours", async () => {
  const gunId = poseGun(h, TOWER, HEAT);
  const target = poseMarkAt(h, "mote", TARGET.x, TARGET.y);
  const neighbours: { name: string; id: number; opened: number }[] = [];
  for (const spot of NEIGHBOURS) {
    const id = poseMarkAt(h, "mote", TARGET.x + spot.dx, TARGET.y + spot.dy);
    neighbours.push({ name: spot.name, id, opened: readHp(h, id) });
  }

  const openedTarget = readHp(h, target);

  await captureReplay(h, "splash", () =>
    h.advance(ticksForShots(1, fireRateOf(TOWER))),
  );
  const closing = h.snapshot();
  const gun = readGun(h, gunId);

  assertEqual(
    gun.targeting,
    target,
    "precondition: the Bloom fired on the eastmost mark, so the impact is " +
      "where the splash is measured from",
  );

  const onTarget = openedTarget - unitOf(closing, target).hp;
  assertGreaterThan(
    onTarget,
    0,
    `hp the ${TOWER}'s shot removed from its own target`,
  );

  for (const near of neighbours) {
    const dealt = near.opened - unitOf(closing, near.id).hp;
    assertCloseTo(
      dealt,
      onTarget,
      EQUAL_DIGITS,
      `hp removed from the ${near.name} neighbour, inside the ` +
        `${SPLASH_UNITS}-unit splash, against the ${onTarget} the target took`,
    );
  }
});
