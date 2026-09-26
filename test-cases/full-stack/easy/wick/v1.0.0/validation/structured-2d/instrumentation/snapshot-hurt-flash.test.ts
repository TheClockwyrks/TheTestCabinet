// Wick — instrumentation/snapshot-hurt-flash: `run.hurtFlash` is present in
// every snapshot and reads the seconds left of the hurt flash.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Snapshot shape", lists `hurtFlash: <number>` inside `run` as "seconds left
// of the hurt flash", under "The shape is fixed, and every field is present
// whatever the screen". `specs/world.md`, Contact damage, gives the figure and
// the only thing that sets it: "The lamplighter carries `hurtFlash`, a timer
// that counts down with the contact cooldowns in phase 7 and is set to
// `HURT_FLASH` on every tick on which a contact hit lands", and "It is `0` on
// the idle run and on a fresh run". The same section's table: "Seconds the
// hurt flash runs | `HURT_FLASH` | `0.3`".
//
// WHAT IS READ, AND WHY. `run.hurtFlash` off the snapshot on four screens, on
// a run that has taken no hit, and on the tick a hit lands. A build that never
// reported the field, reported it only on `playing`, or reported it in ticks
// rather than seconds is told apart by those readings.
//
// THE DRIVE. The screens are reached through `reset`, `setScreen`, and the
// real ticks the harness runs. The hit is one rat posed 20 units from the
// lamplighter with `enemyContact` on and one tick: a rat's radius is `12` and
// `PLAYER_RADIUS` is `12` (`specs/enemies.md`, `specs/world.md`), so 20 units
// is inside the `24` the overlap rule gives, and a spawned enemy's
// `contactCooldown` is `0`, which `specs/world.md`, Timers, makes due at once.
// The hit is read back as a fall in `hp` before the timer is asserted, so a
// tick that landed nothing cannot pass this as a flash.
//
// THE TOLERANCE. `REAL_EPS` on the armed reading: the timer is SET on that
// tick rather than counted down, so a conformant build holds the literal
// `0.3`. The unhit readings are exact zeroes.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLessThan,
  assertNear,
  assertTypeOf,
} from "../assert";
import {
  ENEMIES,
  HURT_FLASH,
  PLAYER_RADIUS,
  REAL_EPS,
  type EnemyId,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  poseScreen,
  type Harness,
  type Screen,
} from "../harness";

/** The enemy the hit comes from, and how far off it stands. */
const HIT_ENEMY: EnemyId = "rat";
const HIT_OFFSET = 20;

/** Ticks run on the unhit run: long enough that a timer left running is seen. */
const QUIET_TICKS = 30;

/** The screens the field is read on before any hit has landed. */
const QUIET_SCREENS: readonly Screen[] = ["title", "howto", "almanac"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports hurtFlash on every screen, 0 with no hit and HURT_FLASH on the hit's tick", async () => {
  h.reset();
  for (const screen of QUIET_SCREENS) {
    const s = poseScreen(h, screen);
    assertTypeOf(s.run.hurtFlash, "number", `run.hurtFlash on ${screen}`);
    assertEqual(s.run.hurtFlash, 0, `run.hurtFlash on ${screen}, the idle run`);
  }

  const fresh = isolate(h);
  assertTypeOf(fresh.run.hurtFlash, "number", "run.hurtFlash on playing");
  assertEqual(fresh.run.hurtFlash, 0, "run.hurtFlash on a run that has no hit");
  const quiet = await advanceTicks(h, QUIET_TICKS);
  assertEqual(
    quiet.run.hurtFlash,
    0,
    `run.hurtFlash after ${QUIET_TICKS} ticks with no contact hit`,
  );

  if (!(HIT_OFFSET < ENEMIES[HIT_ENEMY].radius + PLAYER_RADIUS)) {
    throw new Error("the posed offset must be inside the overlap bound");
  }
  placeEnemyNear(h, HIT_ENEMY, HIT_OFFSET, 0);
  enable(h, "enemyContact");
  const armed = await advanceTicks(h, 1);
  await h.frameDraw();
  captureStill(h, "flash");
  assertLessThan(
    armed.run.player.hp,
    quiet.run.player.hp,
    "the contact hit landed on the tick (specs/world.md, Contact damage)",
  );
  assertNear(
    armed.run.hurtFlash,
    HURT_FLASH,
    REAL_EPS,
    "run.hurtFlash reads the seconds left of the flash on the hit's tick",
  );
});
