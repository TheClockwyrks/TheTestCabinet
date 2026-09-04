// sconce/rehit-interval — a sconce re-hits the same enemy once every
// SCONCE_REHIT.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): "Its pierce
// is `INFINITE_PIERCE`, its re-hit interval is `SCONCE_REHIT` (`0.5`) per
// sconce per enemy". "Projectiles and pierce" fixes what that interval means:
// "A projectile with infinite pierce hits a given enemy at most once per its
// weapon's re-hit interval, timed per projectile and per enemy from the tick
// of the previous hit", and `specs/world.md` ("Timers") makes an interval of
// `0.5` seconds `round(0.5 × 60)` = 30 ticks. So a sconce standing on a hound
// takes its `damage` off on tick 1, nothing on the 29 ticks between, and the
// same `damage` again on tick 31.
//
// WHAT THE DAMAGE IS. Sconce is not held, so a posed sconce takes its figures
// from level 1's row (`specs/instrumentation.md`, `spawnProjectile`): `damage`
// 12 times a `damageMul` of `1` with no passive held. Two hits take the
// hound's 120 hp to 96, so it is alive for every reading and the check is
// about the schedule rather than a death.
//
// WHY THE SCONCE IS HELD STILL. The interval is what is being read, not the
// flight: `effectMotion` off means "every projectile holds its position and
// velocity" while "`ttl` and every re-hit entry still count, and hits still
// resolve" (`specs/instrumentation.md`), so the sconce stays on the hound for
// the whole 31 ticks and every tick it does not hit is the interval's doing.
// Its velocity is still `600 × (0.6, 0.8)`, since "a zero velocity is invalid
// for `sconce`", and it moves nowhere under the held switch.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one hound and one
// sconce on it and nothing else: `enemyMotion` off so the hound stays under
// the sconce, `enemyContact` off so no contact damage enters the reading,
// `weaponFire` off so nothing else fires, and no passive scaling a figure.
// The sconce's `ttl` of 2.5 seconds is 150 ticks, so it outlives the span.
//
// THE TOLERANCE. `REAL_EPS` on each hp, two subtractions of a small real; the
// nearest wrong figure, a hit on the tick between or a missed re-hit, is 12
// away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { REAL_EPS, SCONCE_LEVELS, SCONCE_REHIT, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { LAUNCH_DIRECTION } from "./firing";
import { placeSconce } from "./flight";

/** Where the hound stands, and where the sconce is posed on it. */
const AT = { x: 200, y: 0 };

/** Ticks between one sconce's hits on one enemy: `round(0.5 × 60)` = 30. */
const INTERVAL = ticksOf(SCONCE_REHIT);

/** What one hit removes: level 1's damage of 12 with no passive held. */
const DAMAGE = SCONCE_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("damages the hound on tick 1 and again on tick 31, with none between", async () => {
  isolate(h);
  const hound = placeEnemyNear(h, "hound", AT.x, AT.y);
  const before = enemyById(h.snapshot(), hound);
  if (before === undefined) throw new Error("the posed hound is missing");
  placeSconce(h, before.x, before.y, LAUNCH_DIRECTION);

  const trace = await captureReplay(h, "rehit", async () => {
    const first = await advanceTicks(h, 1);
    const between = await advanceTicks(h, INTERVAL - 1);
    const second = await advanceTicks(h, 1);
    return {
      first: enemyById(first, hound)?.hp ?? NaN,
      between: enemyById(between, hound)?.hp ?? NaN,
      second: enemyById(second, hound)?.hp ?? NaN,
    };
  });

  assertNear(
    trace.first,
    before.hp - DAMAGE,
    REAL_EPS,
    `the hound's hp after tick 1, one sconce's hit of ${DAMAGE} from ${before.hp} (specs/weapons.md, Sconce)`,
  );
  assertNear(
    trace.between,
    before.hp - DAMAGE,
    REAL_EPS,
    `the hound's hp after tick ${INTERVAL}, no hit between the first and the re-hit (specs/weapons.md, Projectiles and pierce)`,
  );
  assertNear(
    trace.second,
    before.hp - 2 * DAMAGE,
    REAL_EPS,
    `the hound's hp after tick ${INTERVAL + 1}, the re-hit an interval of SCONCE_REHIT later (specs/weapons.md, Sconce)`,
  );
});
