// instrumentation/snapshot-hurt-flash — `run.hurtFlash` is present in every
// snapshot and reads the seconds left of the flash: HURT_FLASH (0.3) on the
// tick a contact hit lands, and 0 on a run that has taken none.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "Snapshot shape":
// "`hurtFlash`: seconds left of the hurt flash", inside `run`. specs/world.md,
// Contact damage: "Seconds the hurt flash runs | `HURT_FLASH` | `0.3`", and
// "The lamplighter carries `hurtFlash`, a timer that counts down with the
// contact cooldowns in phase 7 and is set to `HURT_FLASH` on every tick on
// which a contact hit lands, whatever the number of hits that tick. It is `0`
// on the idle run and on a fresh run". specs/state.md, The idle run:
// "`hurtFlash` | `0`".
//
// THE POSE. An isolated night with `enemyContact` the only faculty on, so the
// tick that runs does one thing. One gnat is posed 10 units along +x, inside
// the 20 its radius 8 and PLAYER_RADIUS (12) sum to, and held there with
// `enemyMotion` off; its `contactCooldown` is 0 at spawn, so the hit lands on
// the first tick. The hit is READ AS A HIT before the timer is read, off the
// health the lamplighter lost, so a build that never hits reports that rather
// than a missing flash.
//
// THE TOLERANCE is FIGURE_TOLERANCE: `HURT_FLASH` is a stated figure the tick
// assigns rather than integrates, so no error accumulates in it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertHasProperty,
  assertLessThan,
  assertWithin,
} from "../assert";
import {
  BASE_MAX_HP,
  ENEMIES,
  FIGURE_TOLERANCE,
  HURT_FLASH,
  PLAYER_RADIUS,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy that hits: radius 8, so 10 units out is inside the overlap. */
const TYPE = "gnat";

/** Where it is posed, comfortably inside `radius + PLAYER_RADIUS`. */
const OFFSET = 10;

/** The distance the circles stop overlapping at: 8 + 12. */
const CONTACT_REACH = ENEMIES[TYPE].radius + PLAYER_RADIUS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads 0 on a run that has taken no hit and HURT_FLASH on the hit tick", async () => {
  const posed = isolate(h);
  assertHasProperty(posed.run, "hurtFlash", "snapshot().run");
  assertEqual(
    posed.run.hurtFlash,
    0,
    "run.hurtFlash on a run that has taken no hit",
  );

  enable(h, "enemyContact");
  spawnEnemyNear(h, TYPE, OFFSET, 0);
  assertLessThan(
    OFFSET,
    CONTACT_REACH,
    "the gnat is posed inside the overlap it hits from",
  );

  const hit = await h.tick(1);
  captureStill(h, "flash");

  assertLessThan(
    hit.run.player.hp,
    BASE_MAX_HP,
    "the contact hit landed on the tick read",
  );
  assertWithin(
    hit.run.hurtFlash,
    HURT_FLASH,
    FIGURE_TOLERANCE,
    "run.hurtFlash on the tick the hit landed",
  );
});
