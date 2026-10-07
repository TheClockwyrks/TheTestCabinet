// enemies/owl-row — an owl spawns with the row `specs/enemies.md` gives it.
//
// WHERE THE THRESHOLDS COME FROM. `specs/enemies.md` ("Elites and the Dark")
// gives the owl's row: hp 2000, speed 100, damage 30, radius 36. The same
// section adds that each of the three "spawns with exactly the HP in its row",
// so an owl spawned at a run clock of 300 seconds, where `hpMul` reads `1.75`
// and a common's health would be scaled by it ("Health scaling"), still
// carries `maxHp` 2000; it "spawns at full health" ("The life of an enemy"),
// so `hp` reads 2000 too.
//
//   - THE STEP. "Every rate below is per second, integrated on the fixed tick,
//     so one tick's step is `speed * TICK_DT` units" ("Movement"), so one tick
//     advances 100 / 60 units. An owl's behavior is `chase`, so the point that
//     advances is its position, along the heading it recomputes.
//   - THE HIT. `specs/world.md` ("Contact damage"): "An overlapping enemy
//     whose `contactCooldown` is due lands a hit: `hp` falls by
//     `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`", and `armor` "is `0` with
//     no Brass held", so the hit removes exactly 30.
//   - THE RADIUS. The same file makes the circles overlap when "the distance
//     between their centers is less than the enemy's radius plus
//     `PLAYER_RADIUS`", and `PLAYER_RADIUS` is `12` ("The lamplighter"), so
//     the bound is 36 + 12 = 48. No snapshot field carries a radius, so it is
//     read through that bound from both sides at once: a hit one unit inside
//     48 and none one unit outside it, which no radius but 36 satisfies.
//
// WHY THE WORLD IS POSED AS IT IS. `enemies/roster` states the arrangement
// this check shares with the other twelve rows: an owl alone in an isolated
// run, spawned at a run clock of 300 seconds, where a common's health would be
// scaled by `1.75`, holding no weapon and no passive, with the one driver
// switch each reading needs on for the one tick it needs it and every other
// switch off.
//
// THE TOLERANCE. `REAL_EPS` on the two health readings, table figures copied
// at spawn, and on the two contact readings, each a subtraction of two small
// reals; `MOTION_EPS` on the step, a unit vector scaled by 100 / 60 and
// integrated once.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, MOTION_EPS, REAL_EPS, TICK_DT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { BOUND_MARGIN, overlapBound, readRow } from "./roster";

const TYPE = "owl";

/** The owl's row, as `specs/enemies.md` tabulates it. */
const ROW = ENEMIES[TYPE];

/** The center distance inside which an owl overlaps the lamplighter. */
const BOUND = overlapBound(TYPE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns an owl reading 2000 hp, a step of 100 × TICK_DT, a touch of 30, and a radius of 36", async () => {
  const reading = await readRow(h, TYPE);
  captureStill(h, "row");

  assertNear(
    reading.maxHp,
    ROW.hp,
    REAL_EPS,
    "the owl's maxHp on its spawn tick (specs/enemies.md, Elites and the Dark and Health scaling)",
  );
  assertNear(
    reading.hp,
    ROW.hp,
    REAL_EPS,
    "the owl's hp on its spawn tick (specs/enemies.md, The life of an enemy)",
  );
  assertNear(
    reading.step,
    ROW.speed * TICK_DT,
    MOTION_EPS,
    "how far one tick with enemyMotion on advanced the owl (specs/enemies.md, Movement)",
  );
  assertNear(
    reading.insideLoss,
    ROW.damage,
    REAL_EPS,
    `the health the lamplighter lost with the owl ${BOUND_MARGIN} unit inside its overlap bound of ${BOUND} (specs/world.md, Contact damage)`,
  );
  assertNear(
    reading.outsideLoss,
    0,
    REAL_EPS,
    `the health the lamplighter lost with the owl ${BOUND_MARGIN} unit outside that bound of ${BOUND} (specs/world.md, Contact damage)`,
  );
});
