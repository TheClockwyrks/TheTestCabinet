// director/swarm-gnats-scaled — a swarm's gnats are as tough as the hour.
//
// THE SPEC LINE. `specs/enemies.md`, "Scripted events": "Swarm gnats take
// health scaling like any common enemy and despawn by distance like any common
// enemy." "Health scaling" gives the rule:
// `hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)` with
// `HP_SCALE_PER_MINUTE` (`0.15`) and `time` "the run clock, in seconds, on the
// tick the enemy spawns", and "A common enemy spawns with
// `maxHp = hp * hpMul(time)` and `hp = maxHp`".
//
// THE ARITHMETIC AT 1:00. The swarm fires on tick 3600, a run clock of exactly
// 60 s, so `floor(60 / 60)` is 1 and the multiplier is `1 + 0.15 × 1 = 1.15`.
// A gnat's base HP is 2 in the roster, so every gnat of that swarm carries
// `2 × 1.15 = 2.3` as both `maxHp` and `hp`. A build that spawns its swarm
// unscaled reads 2 here; one that scales by the wrong minute reads 2 or 2.6.
//
// WHY BOTH FIELDS ARE READ. "spawns at full health" (`specs/enemies.md`, "The
// life of an enemy"), so the two agree on the tick it spawns, and a build that
// scaled the cap without filling it is caught.
//
// THE DRIVE. The isolated world with `events` alone on and the one tick that
// crosses tick 3600.
//
// THE TOLERANCE. `REAL_EPS`: one product of a table figure with a multiplier.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, EVENTS, REAL_EPS, SWARM_SIZE, hpMul } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick } from "./spawns";

/** The 1:00 swarm, and the tick it fires on. */
const EVENT = EVENTS[0];
const FIRES_ON = eventTick(EVENT.time);

/** `2 × hpMul(60)`, the health a gnat of that swarm carries. */
const SCALED_HP = ENEMIES.gnat.hp * hpMul(EVENT.time);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns the 1:00 swarm's gnats with maxHp 2.3", async () => {
  isolate(h);
  h.debug.setTick(FIRES_ON - 1);
  enable(h, "events");

  const drive = await driveArrivals(h, 1);
  captureStill(h, "scaled");

  assertEqual(
    drive.arrivals.length,
    SWARM_SIZE,
    `the gnats the ${EVENT.time} s swarm spawned`,
  );
  for (const { enemy } of drive.arrivals) {
    assertNear(
      enemy.maxHp,
      SCALED_HP,
      REAL_EPS,
      `gnat ${enemy.id}: maxHp on the tick it spawned, at a run clock of ${EVENT.time} s`,
    );
    assertNear(
      enemy.hp,
      SCALED_HP,
      REAL_EPS,
      `gnat ${enemy.id}: the health it spawned at`,
    );
  }
});
