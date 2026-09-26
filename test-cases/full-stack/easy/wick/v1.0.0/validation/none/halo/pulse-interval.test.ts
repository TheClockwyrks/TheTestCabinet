// Wick — halo/pulse-interval: Halo pulses on the tick its timer is due, once
// every cooldown, and the timer reads the cooldown after each pulse.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): "It is a
// pulsing effect whose interval is its cooldown: on each tick the cooldown
// timer is due it pulses, every enemy whose circle overlaps the aura takes
// `damage`, and the timer is set to the current cooldown. Halo pulses on the
// first `playing` tick it is held." Row 1 of `HALO_LEVELS` carries damage `3`
// and cooldown `1.00`, and with no Oil held `cooldownMul` is `1`
// (`specs/passives.md`). `specs/world.md` ("Timers") fixes when a timer set to
// `1.0` is due again: "a timer set to `s` seconds is due `round(s × TICK_HZ)`
// ticks after the tick it was set on", `60` ticks. So an overlapping enemy
// takes `3` on tick 1 and again on tick 61, nothing on the ticks between,
// and the timer reads `1.0` after each of the two pulses.
//
// THE POSE. An isolated night with the clock posed at `POSED_TICK`, then one
// moth `40` along `+x` from the lamplighter, then Halo held at level 1 and its
// first tick run through the shared `fireWeapon` (held, due, `weaponFire` on,
// one tick), and sixty more ticks stepped one at a time. The clock is posed so
// the moth has health for both pulses: `specs/enemies.md` ("Health scaling")
// spawns a common with "`maxHp = hp * hpMul(time)`" and `spawnEnemy` scales a
// posed enemy "by the run clock exactly as a director spawn is", so at
// `POSED_TICK` (`500` seconds) a moth spawns with `5 × 2.2` = `11` hp, and two
// pulses of `3` leave it alive at `5`. That the moth has more health than the
// two pulses take is read as a precondition of the pose. `enemyMotion` and
// `enemyContact` stay held, so the moth stands where it was posed and hits
// nothing back, and every other faculty is held, so nothing else reaches it.
// Nothing on the posed clock runs: the events, the spawns, and the despawns
// are switched off, and dawn is `6000` ticks away.
//
// TOLERANCE. `FLOAT_TOL` on the moth's hp, a real less `3 × 1` per pulse;
// `TIMER_TOL` on the timer read straight after each pulse, which a build sets
// from the table figure. The ticks the pulses land on are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { FLOAT_TOL, TIMER_TOL, dueTicks, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  fireWeapon,
  isolate,
  mustEnemy,
  type Harness,
} from "../harness";
import { HALO, placeTarget } from "./stage";

/** The level whose row is held: damage `3`, cooldown `1.0`. */
const LEVEL = 1;

/** Halo's level-1 row. */
const ROW = weaponRow(HALO, LEVEL);

/** The ticks between two pulses: `round(1.0 × 60)`. */
const PULSE_TICKS = dueTicks(ROW.cooldown!);

/** The pulses watched for: the first tick and one cooldown later. */
const PULSES = 2;

/** The clock the night is posed at: `500` seconds, so a moth spawns with `11` hp. */
const POSED_TICK = 30000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pulses on tick 1 and tick 61, nothing between, with the timer at 1.0 after each pulse", async () => {
  await isolate(h);
  await h.debug.setTick(POSED_TICK);
  const moth = await placeTarget(h, "moth");
  assertGreaterThan(
    moth.hp,
    PULSES * ROW.damage,
    `the posed moth's hp against the ${PULSES} pulses of ${ROW.damage} it must survive`,
  );

  const { firing, ticks } = await captureReplay(h, "pulses", async () => {
    const firing = await fireWeapon(h, HALO, LEVEL);
    const ticks = await h.stepWatching(PULSE_TICKS);
    return { firing, ticks };
  });

  assertEqual(ticks.length, PULSE_TICKS, "ticks stepped after the first pulse");
  const afterFirst = moth.hp - ROW.damage;
  assertNear(
    mustEnemy(firing.after, moth.id).hp,
    afterFirst,
    FLOAT_TOL,
    "the moth's hp on tick 1, the first pulse",
  );
  assertNear(
    firing.after.run.weapons?.[firing.slot]?.cooldown ?? NaN,
    ROW.cooldown!,
    TIMER_TOL,
    "Halo's timer after the pulse on tick 1",
  );

  for (const [index, snapshot] of ticks.entries()) {
    const tick = index + 2;
    if (tick < 1 + PULSE_TICKS) {
      assertNear(
        mustEnemy(snapshot, moth.id).hp,
        afterFirst,
        FLOAT_TOL,
        `the moth's hp on tick ${tick}, between the pulses`,
      );
    }
  }

  const second = ticks[ticks.length - 1]!;
  assertNear(
    mustEnemy(second, moth.id).hp,
    afterFirst - ROW.damage,
    FLOAT_TOL,
    `the moth's hp on tick ${1 + PULSE_TICKS}, the second pulse`,
  );
  assertNear(
    second.run.weapons?.[firing.slot]?.cooldown ?? NaN,
    ROW.cooldown!,
    TIMER_TOL,
    `Halo's timer after the pulse on tick ${1 + PULSE_TICKS}`,
  );
});
