// Wick — weapons/damage-fixed-at-creation: a shape's damage is fixed when it is
// created.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Hits and death"): "A
// shape's damage per hit is fixed when the shape is created, from the level
// and `damageMul` in force on that tick, with one exception: the aura of Halo
// or Corona and each Chandelier lantern have their damage recomputed on every
// tick, with their radius. A Wick level gained later leaves every other live
// shape's damage as it was." Oil Splash's level-1 row carries damage `4`, and
// `specs/instrumentation.md` has `spawnPuddle` give a puddle "that row's damage
// times the `damageMul` in force at the call", pulsing "first on the next tick
// and every `OIL_PULSE` ... after", with `OIL_PULSE` `0.3` — `18` ticks by the
// timer rule of `specs/world.md`. So a puddle posed with no Wick held carries
// `4`, still carries `4` once Wick 2 is held (a recomputing build would read
// `4 × 1.2` = `4.8`), and each pulse removes `4`.
//
// THE POSE. A puddle posed with no Wick held, a hound on its center so each
// pulse has something to hit (`120` hp outlives every pulse, and a hound
// stands well clear of the lamplighter), then Wick at level 2 through
// `setPassive`, then the ticks: the first pulse lands on tick `1` and the
// second on tick `19`. The damage is read off the puddle after the pose,
// after the passive, and after the ticks, and the hound's hp after each pulse.
// Every faculty is held; a puddle's pulses are gated by none of them.
//
// TOLERANCE. `FLOAT_TOL` on every figure: `4`, `116`, and `112` are exact, and
// the recomputed alternative is `0.8` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  OIL_PULSE,
  dueTicks,
  weaponRow,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  mustEnemy,
  mustZone,
  placeEnemy,
  placePuddle,
  type Harness,
} from "../harness";

/** Where the puddle lands, well clear of the lamplighter. */
const PUDDLE = { x: 200, y: 120 };

/** Oil Splash's level-1 damage, `4`. */
const PUDDLE_DAMAGE = weaponRow("oil-splash", 1).damage;

/** The Wick level gained while the puddle lives. */
const WICK_LEVEL = 2;

/** Ticks between two pulses: `round(0.3 × 60)` = `18`. */
const PULSE_TICKS = dueTicks(OIL_PULSE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a posed puddle's damage at 4 across a Wick level gained while it lives", async () => {
  await isolate(h);
  const puddle = await placePuddle(h, "oil-splash", PUDDLE.x, PUDDLE.y);
  const hound = await placeEnemy(h, "hound", PUDDLE.x, PUDDLE.y);
  assertNear(
    puddle.damage,
    PUDDLE_DAMAGE,
    FLOAT_TOL,
    "the puddle's damage as posed",
  );

  await holdPassive(h, "wick", WICK_LEVEL);
  const raised = await h.snapshot();
  assertNear(
    mustZone(raised, puddle.id).damage,
    PUDDLE_DAMAGE,
    FLOAT_TOL,
    "the puddle's damage once Wick 2 is held",
  );

  const firstPulse = await h.step(1);
  assertNear(
    mustZone(firstPulse, puddle.id).damage,
    PUDDLE_DAMAGE,
    FLOAT_TOL,
    "the puddle's damage on its first pulse tick under Wick 2",
  );
  assertNear(
    mustEnemy(firstPulse, hound.id).hp,
    ENEMIES.hound.hp - PUDDLE_DAMAGE,
    FLOAT_TOL,
    "the hound's hp after the first pulse",
  );

  const secondPulse = await h.step(PULSE_TICKS);
  await captureStill(h, "fixed");
  assertNear(
    mustZone(secondPulse, puddle.id).damage,
    PUDDLE_DAMAGE,
    FLOAT_TOL,
    "the puddle's damage on its second pulse tick under Wick 2",
  );
  assertNear(
    mustEnemy(secondPulse, hound.id).hp,
    ENEMIES.hound.hp - 2 * PUDDLE_DAMAGE,
    FLOAT_TOL,
    "the hound's hp after the second pulse",
  );
});
