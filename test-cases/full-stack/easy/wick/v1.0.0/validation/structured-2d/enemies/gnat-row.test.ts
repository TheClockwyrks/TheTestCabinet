// enemies/gnat-row — a gnat spawns with the row `specs/enemies.md` gives it.
//
// WHERE THE THRESHOLDS COME FROM. `specs/enemies.md` ("Common enemies") gives
// the gnat's row: hp 2, speed 160, damage 3, radius 8. The same section adds
// "All ten are rank `common`. The HP column is the base the scaling below
// multiplies at spawn", and `hpMul(0)` is `1` at a run clock of `0` ("Health
// scaling"), so a gnat spawned at time 0 carries `maxHp` 2; it "spawns at full
// health" ("The life of an enemy"), so `hp` reads 2 too.
//
//   - THE STEP. "Every rate below is per second, integrated on the fixed tick,
//     so one tick's step is `speed * TICK_DT` units" ("Movement"), so one tick
//     advances 160 / 60 units. A gnat's behavior is `drift`, so the point that
//     advances is its position, along the heading it spawned with.
//   - THE HIT. `specs/world.md` ("Contact damage"): "An overlapping enemy
//     whose `contactCooldown` is due lands a hit: `hp` falls by
//     `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`", and `armor` "is `0` with
//     no Brass held", so the hit removes exactly 3.
//   - THE RADIUS. The same file makes the circles overlap when "the distance
//     between their centers is less than the enemy's radius plus
//     `PLAYER_RADIUS`", and `PLAYER_RADIUS` is `12` ("The lamplighter"), so
//     the bound is 8 + 12 = 20. No snapshot field carries a radius, so it is
//     read through that bound from both sides at once: a hit one unit inside
//     20 and none one unit outside it, which no radius but 8 satisfies.
//
// WHY THE WORLD IS POSED AS IT IS. `enemies/roster` states the arrangement
// this check shares with the other twelve rows: a gnat alone in an isolated
// run, spawned at a run clock of `0`, holding no weapon and no passive, with
// the one driver switch each reading needs on for the one tick it needs it and
// every other switch off.
//
// THE TOLERANCE. `REAL_EPS` on the two health readings, table figures copied
// at spawn, and on the two contact readings, each a subtraction of two small
// reals; `MOTION_EPS` on the step, a unit vector scaled by 160 / 60 and
// integrated once.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, MOTION_EPS, REAL_EPS, TICK_DT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { BOUND_MARGIN, overlapBound, readRow } from "./roster";

const TYPE = "gnat";

/** The gnat's row, as `specs/enemies.md` tabulates it. */
const ROW = ENEMIES[TYPE];

/** The center distance inside which a gnat overlaps the lamplighter. */
const BOUND = overlapBound(TYPE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns a gnat reading 2 hp, a step of 160 × TICK_DT, a touch of 3, and a radius of 8", async () => {
  const reading = await readRow(h, TYPE);
  captureStill(h, "row");

  assertNear(
    reading.maxHp,
    ROW.hp,
    REAL_EPS,
    "the gnat's maxHp on its spawn tick (specs/enemies.md, Common enemies and Health scaling)",
  );
  assertNear(
    reading.hp,
    ROW.hp,
    REAL_EPS,
    "the gnat's hp on its spawn tick (specs/enemies.md, The life of an enemy)",
  );
  assertNear(
    reading.step,
    ROW.speed * TICK_DT,
    MOTION_EPS,
    "how far one tick with enemyMotion on advanced the gnat (specs/enemies.md, Movement)",
  );
  assertNear(
    reading.insideLoss,
    ROW.damage,
    REAL_EPS,
    `the health the lamplighter lost with the gnat ${BOUND_MARGIN} unit inside its overlap bound of ${BOUND} (specs/world.md, Contact damage)`,
  );
  assertNear(
    reading.outsideLoss,
    0,
    REAL_EPS,
    `the health the lamplighter lost with the gnat ${BOUND_MARGIN} unit outside that bound of ${BOUND} (specs/world.md, Contact damage)`,
  );
});
