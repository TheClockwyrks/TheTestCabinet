// Wick — evolutions/corona-pulse-interval: Corona pulses once every cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Corona
// pulses on its first tick and on every tick its cooldown timer is due", over
// `CORONA_STATS`, "where the cooldown is the pulse interval": `0.5` seconds,
// times a `cooldownMul` of `1` with no Oil held (`specs/passives.md`).
// `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", so `round(0.5 × 60)`
// = `30` ticks. So an overlapping enemy takes `12` on tick `1`, nothing on the
// twenty-nine ticks between, and `12` again on tick `31`, and the timer reads
// `0.5` after each pulse.
//
// THE PROBE. A hound: `120` hp and radius `18` (`specs/enemies.md`), unscaled at
// a run clock of `0`, so it outlives both pulses of `12` and the schedule is
// read as two falls in `hp` rather than as a death. It stands `40` along `+x`,
// inside the `150 + 18` at which the two circles overlap.
//
// THE POSE. An isolated night with the hound posed and Corona held at level 1
// fired through the shared `fireWeapon`, then thirty ticks stepped one at a
// time. `enemyMotion` and `enemyContact` stay held, so the hound stands under
// the aura and lands nothing back, and nothing else runs. The replay covers the
// first pulse and the thirty ticks to the second.
//
// TOLERANCE. `FLOAT_TOL` on the hound's hp; `TIMER_TOL` on the timer read
// straight after each pulse. The ticks are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  TIMER_TOL,
  dueTicks,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  fireWeapon,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** Corona's fixed row, `CORONA_STATS`. */
const ROW = weaponRow("corona");

/** The ticks between two pulses: `round(0.5 × 60)` = `30`. */
const PULSE_TICKS = dueTicks(ROW.cooldown as number);

/** How far along `+x` the probe stands: inside the aura, clear of contact. */
const TARGET_OFFSET = 40;

/** A hound's table hp, `120`, unscaled at a run clock of `0`. */
const HOUND_HP = ENEMIES.hound.hp;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes 12 from a hound on tick 1 and again on tick 31, nothing between, with the timer at 0.5 after each", async () => {
  await isolate(h);
  const hound = await placeEnemyNear(h, "hound", TARGET_OFFSET, 0);
  assertEqual(hound.hp, HOUND_HP, "the hound's hp as posed");

  const drive = await captureReplay(h, "pulses", async () => {
    const firing = await fireWeapon(h, "corona", 1);
    const ticks = await h.stepWatching(PULSE_TICKS);
    return { firing, ticks };
  });

  assertEqual(
    drive.ticks.length,
    PULSE_TICKS,
    "ticks stepped after the first pulse",
  );
  const afterFirst = HOUND_HP - ROW.damage;
  assertNear(
    mustEnemy(drive.firing.after, hound.id).hp,
    afterFirst,
    FLOAT_TOL,
    "the hound's hp on tick 1, the first pulse",
  );
  assertNear(
    drive.firing.after.run.weapons?.[drive.firing.slot]?.cooldown ?? NaN,
    ROW.cooldown ?? NaN,
    TIMER_TOL,
    "Corona's timer after the pulse on tick 1",
  );
  for (const [index, snapshot] of drive.ticks.entries()) {
    const tick = index + 2;
    if (tick < 1 + PULSE_TICKS) {
      assertNear(
        mustEnemy(snapshot, hound.id).hp,
        afterFirst,
        FLOAT_TOL,
        `the hound's hp on tick ${tick}, between the pulses`,
      );
    }
  }
  const second = drive.ticks[
    drive.ticks.length - 1
  ] as (typeof drive.ticks)[number];
  assertNear(
    mustEnemy(second, hound.id).hp,
    afterFirst - ROW.damage,
    FLOAT_TOL,
    `the hound's hp on tick ${1 + PULSE_TICKS}, the second pulse`,
  );
  assertNear(
    second.run.weapons?.[drive.firing.slot]?.cooldown ?? NaN,
    ROW.cooldown ?? NaN,
    TIMER_TOL,
    `Corona's timer after the pulse on tick ${1 + PULSE_TICKS}`,
  );
});
