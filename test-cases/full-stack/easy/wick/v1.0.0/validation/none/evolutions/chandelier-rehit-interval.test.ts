// Wick — evolutions/chandelier-rehit-interval: each lantern re-hits an enemy
// once every `LANTERN_REHIT`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "Each
// lantern is a touching effect with re-hit interval `LANTERN_REHIT` (`0.5`),
// timed per lantern per enemy." `specs/weapons.md` ("Persistent effects"): a
// touching effect "damages an enemy on any tick the two overlap, at most once
// per re-hit interval per effect per enemy". `specs/world.md` ("Timers"): "An
// interval of `s` seconds anywhere in this specification is likewise
// `round(s × TICK_HZ)` ticks", so the interval is `round(0.5 × 60)` = `30`
// ticks. `CHANDELIER_STATS` gives damage `25`, orbit `120`, and radius `20`,
// each times a multiplier of `1` with no passive held; a hound has `120` hp and
// radius `18` (`specs/enemies.md`), unscaled at a run clock of `0`, and "Two
// circles overlap when the distance between their centers is less than the sum
// of their radii". So a hound posed at the point the lantern at angle `0`
// stands on — `(orbit, 0)` from the lamplighter — is hit on the tick the set is
// placed, taking it to `95`, is untouched for the next `29`, and is hit again on
// the `30th` tick after, taking it to `70`.
//
// WHY ONE LANTERN AND NOT FOUR. The other three stand at `90`, `180`, and `270`
// degrees, `120 × sqrt(2)` = `169.7` units and more from `(120, 0)`, past the
// `20 + 18` at which their circles would overlap the hound's, so exactly one
// lantern reaches it and the schedule read is one lantern's.
//
// THE POSE. An isolated night with every driver switch off, `effectMotion`
// included, so the lantern holds its angle over the hound rather than revolving
// off it and the hound holds its position under it; the hound posed at
// `(120, 0)`; Chandelier held and one tick to place the set; then `29` ticks and
// one more. The replay covers the placing tick and the thirty after it.
//
// TOLERANCE. `FLOAT_TOL` on the hound's hp, every figure a whole `25` apart from
// its alternatives; `TIMER_TOL` on the lantern's re-hit entry. The ticks are
// exact: the schedule is fixed to the tick by the timer rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, fail } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  LANTERN_REHIT,
  TIMER_TOL,
  dueTicks,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  distanceBetween,
  hitEntry,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { placeChandelierSet } from "./stage";

/** Chandelier's fixed row, `CHANDELIER_STATS`. */
const ROW = weaponRow("chandelier");

/** Ticks from one hit to the next: `round(0.5 × 60)` = `30`. */
const REHIT_TICKS = dueTicks(LANTERN_REHIT);

/** A hound's table hp, `120`, unscaled at a run clock of `0`. */
const HOUND_HP = ENEMIES.hound.hp;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits a hound under a lantern on the placing tick and again 30 ticks later", async () => {
  await isolate(h);
  const hound = await placeEnemyNear(h, "hound", ROW.orbit ?? NaN, 0);
  assertEqual(hound.hp, HOUND_HP, "the hound's hp as posed");

  const schedule = await captureReplay(h, "rehit", async () => {
    const set = await placeChandelierSet(h);
    const touching = set.lanterns.filter(
      (lantern) =>
        distanceBetween(lantern, hound) < lantern.radius + ENEMIES.hound.radius,
    );
    if (touching.length !== 1) {
      fail(
        "exactly one Chandelier lantern overlapping the hound on the placing tick",
        set.lanterns.map((lantern) => ({
          id: lantern.id,
          distance: distanceBetween(lantern, hound),
        })),
      );
    }
    const lantern = touching[0] as (typeof set.lanterns)[number];
    const between = await h.step(REHIT_TICKS - 1);
    const second = await h.step(1);
    return { first: set.after, lantern, between, second };
  });

  assertNear(
    mustEnemy(schedule.first, hound.id).hp,
    HOUND_HP - ROW.damage,
    FLOAT_TOL,
    "the hound's hp on the placing tick, the first hit",
  );
  assertNear(
    hitEntry(
      schedule.first.run.zones.find(
        (zone) => zone.id === schedule.lantern.id,
      ) ?? schedule.lantern,
      hound.id,
    )?.cooldown ?? NaN,
    LANTERN_REHIT,
    TIMER_TOL,
    "the lantern's hits entry for the hound on the tick of the first hit",
  );
  assertNear(
    mustEnemy(schedule.between, hound.id).hp,
    HOUND_HP - ROW.damage,
    FLOAT_TOL,
    `the hound's hp ${REHIT_TICKS - 1} ticks after the first hit`,
  );
  assertNear(
    mustEnemy(schedule.second, hound.id).hp,
    HOUND_HP - 2 * ROW.damage,
    FLOAT_TOL,
    `the hound's hp ${REHIT_TICKS} ticks after the first hit`,
  );
});
