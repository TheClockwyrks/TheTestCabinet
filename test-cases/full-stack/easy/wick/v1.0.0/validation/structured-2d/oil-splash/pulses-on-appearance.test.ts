// oil-splash/pulses-on-appearance — a puddle pulses on the tick it appears.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "A
// puddle is a pulsing effect with interval `OIL_PULSE` (`0.3`): it pulses on
// the tick it appears and on every `OIL_PULSE` interval of ticks after, and
// each pulse deals `damage` to every enemy overlapping it." The level table,
// row 1, gives damage 4 and radius 50; with no Wick held `damageMul` is 1
// (`specs/passives.md`), so a moth overlapping the puddle reads its `hp`
// 4 lower after the firing tick. `specs/world.md` ("One tick"), phase 6:
// "every projectile and zone hits, this tick's new ones included, a new one
// hitting at the position it was created at". ("Shapes and overlap"): "Two
// circles overlap when the distance between their centers is less than the
// sum of their radii", the moth's radius being 10 (`specs/enemies.md`).
//
// WHY THE FIELD IS A LATTICE OF MOTHS. The landing point is a random draw
// from the disk of radius 400 about the lamplighter, so no single moth can be
// posed under it, and `oil-splash/firing` tiles the disk with moths at a
// spacing that puts one under every point of it. The moth nearest the landing
// point is the one read. The moths are well apart, hold still, and touch
// nothing: `enemyMotion` and `enemyContact` are off, and the lattice is
// offset so no moth sits on the lamplighter.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with the moths alone, Oil
// Splash at level 1 armed so exactly one puddle lands and no moth can be
// pulsed twice on one tick, `weaponFire` on and every other switch off. A
// moth at 5 `hp` survives a 4-damage pulse, so nothing dies, drops, or draws.
// The verdict is one direction: the overlapping moth's `hp` fell by the
// puddle's damage on the firing tick itself, where a puddle that first
// pulsed a tick late leaves it untouched. The later pulses are
// `pulse-interval`'s point.
//
// THE TOLERANCE. `REAL_EPS` on the `hp` after the pulse: a real subtraction of
// a table figure. A missed pulse is off by the whole 4.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { OIL_SPLASH_LEVELS, REAL_EPS, damageMul } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  type Harness,
} from "../harness";
import {
  LATTICE_CIRCUMRADIUS,
  coverScatterDisk,
  fireFromPosed,
  mothOverlap,
  nearestEnemy,
} from "./firing";

/** Level 1 of Oil Splash: one puddle of radius 50 dealing 4 a pulse. */
const LEVEL = 1;
const ROW = OIL_SPLASH_LEVELS[LEVEL - 1];

/** What one pulse takes from a moth with no Wick held: `4 × 1`. */
const PULSE = ROW.damage * damageMul(0);

/** The distance under which a moth's circle overlaps a level-1 puddle's. */
const OVERLAP = mothOverlap(ROW.radius);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes 4 hp off the moth overlapping a level-1 puddle's landing point on the firing tick", async () => {
  if (!(LATTICE_CIRCUMRADIUS < OVERLAP)) {
    throw new Error("the lattice must put a moth under every landing point");
  }
  isolate(h);
  const ids = coverScatterDisk(h);
  const posed = h.snapshot();
  assertEqual(
    posed.run.enemies.length,
    ids.length,
    "moths in the world after the lattice was posed (specs/instrumentation.md, spawnEnemy)",
  );

  const firing = await fireFromPosed(h, LEVEL);
  captureStill(h, "first");

  assertEqual(
    firing.puddles.length,
    ROW.amount,
    `the puddles the firing tick created at level ${LEVEL} (specs/weapons.md, Oil Splash)`,
  );
  const puddle = firing.puddles[0];
  assertDefined(
    puddle,
    "the puddle the firing tick created (specs/weapons.md, Oil Splash)",
  );
  const before = nearestEnemy(posed.run.enemies, puddle);
  if (!(before.reach < OVERLAP)) {
    throw new Error(
      `the lattice left the nearest moth ${before.reach} from the puddle's center`,
    );
  }
  const after = enemyById(firing.after, before.enemy.id);
  assertDefined(
    after,
    `moth ${before.enemy.id}, the one overlapping the puddle, after the firing tick`,
  );
  assertNear(
    after?.hp ?? NaN,
    before.enemy.hp - PULSE,
    REAL_EPS,
    `moth ${before.enemy.id}'s hp after the firing tick, ${before.reach.toFixed(1)} from the puddle's center, against ${before.enemy.hp} less one pulse of ${PULSE} (specs/weapons.md, Oil Splash)`,
  );
});
