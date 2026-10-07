// Wick — lantern/rehit-interval: each lantern re-hits every `LANTERN_REHIT`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "Each
// lantern is a touching effect with re-hit interval `LANTERN_REHIT` (`0.5`),
// timed per lantern per enemy"; ("Persistent effects") a touching effect
// "damages an enemy on any tick the two overlap, at most once per re-hit
// interval per effect per enemy". Row 1 carries damage `10`, times a
// `damageMul` of `1`. `specs/world.md` ("Timers") makes an interval of `0.5`
// seconds `round(0.5 × 60)` = `30` ticks, and ("One tick", phase 6) every
// re-hit entry counts down before the hits and a new zone hits "at the
// position it was created at". A hound has `120` hp and radius `18`
// (`specs/enemies.md`), a level-1 lantern radius `14`, and "Two circles overlap
// when the distance between their centers is less than the sum of their
// radii". So a lantern created on a hound's center hits it on the firing tick,
// taking it to `110`, holds a hits entry for it reading `0.5` that counts down
// by `TICK_DT` per tick, takes nothing on the 29 ticks after, and hits again on
// the 30th tick after the first hit, taking it to `100`.
//
// THE POSE. One hound posed at `(orbit, 0)` from the lamplighter, which is
// where "lantern `0` ... starts at angle `0`" on the level-1 orbit of `90`;
// Lantern held at level 1 and fired by one tick (`lantern/stage.ts`), then
// `weaponFire` off. `effectMotion` is held so the lantern stays on the hound
// rather than revolving off it, `enemyMotion` so the hound stays under it, and
// the rest so nothing else lands. The replay covers the firing tick and the
// thirty after it.
//
// TOLERANCE. `FLOAT_TOL` on the hound's hp, every figure a whole number `10`
// apart from its alternatives; `TIMER_TOL` on the entry's cooldown.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  LANTERN_REHIT,
  TICK_DT,
  TIMER_TOL,
  dueTicks,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  hitEntry,
  isolate,
  mustEnemy,
  mustZone,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { lanternsOf } from "./stage";

/** The level fired: one lantern at angle `0`. */
const LEVEL = 1;

const ROW = weaponRow("lantern", LEVEL);

/** Ticks from one hit to the next: `round(0.5 × 60)` = `30`. */
const REHIT_TICKS = dueTicks(LANTERN_REHIT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits a hound under a lantern on the firing tick and again 30 ticks later, the entry counting down between", async () => {
  await isolate(h);
  const hound = await placeEnemyNear(h, "hound", ROW.orbit ?? NaN, 0);
  assertEqual(hound.hp, ENEMIES.hound.hp, "the hound's hp as posed");

  const schedule = await captureReplay(h, "rehit", async () => {
    const firing = await fireWeapon(h, "lantern", LEVEL);
    await disable(h, "weaponFire");
    const lanterns = lanternsOf(firing);
    assertEqual(
      lanterns.length,
      1,
      "the lantern the level-1 firing tick created",
    );
    const lantern = lanterns[0]!;
    const next = await h.step(1);
    const last = await h.step(REHIT_TICKS - 2);
    const second = await h.step(1);
    return { lantern, first: firing.after, next, last, second };
  });

  const damage = ROW.damage;
  assertNear(
    mustEnemy(schedule.first, hound.id).hp,
    ENEMIES.hound.hp - damage,
    FLOAT_TOL,
    "the hound's hp on the firing tick",
  );
  assertNear(
    hitEntry(mustZone(schedule.first, schedule.lantern.id), hound.id)
      ?.cooldown ?? NaN,
    LANTERN_REHIT,
    TIMER_TOL,
    "the lantern's hits entry for the hound on the firing tick",
  );
  assertNear(
    hitEntry(mustZone(schedule.next, schedule.lantern.id), hound.id)
      ?.cooldown ?? NaN,
    LANTERN_REHIT - TICK_DT,
    TIMER_TOL,
    "the lantern's hits entry for the hound one tick after the hit",
  );
  assertNear(
    mustEnemy(schedule.last, hound.id).hp,
    ENEMIES.hound.hp - damage,
    FLOAT_TOL,
    `the hound's hp ${REHIT_TICKS - 1} ticks after the first hit`,
  );
  assertNear(
    hitEntry(mustZone(schedule.last, schedule.lantern.id), hound.id)
      ?.cooldown ?? NaN,
    LANTERN_REHIT - (REHIT_TICKS - 1) * TICK_DT,
    TIMER_TOL,
    `the lantern's hits entry for the hound ${REHIT_TICKS - 1} ticks after the hit`,
  );
  assertNear(
    mustEnemy(schedule.second, hound.id).hp,
    ENEMIES.hound.hp - 2 * damage,
    FLOAT_TOL,
    `the hound's hp ${REHIT_TICKS} ticks after the first hit`,
  );
});
