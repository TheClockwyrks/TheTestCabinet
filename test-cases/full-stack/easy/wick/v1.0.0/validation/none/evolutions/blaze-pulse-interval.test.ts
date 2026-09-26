// Wick — evolutions/blaze-pulse-interval: a Blaze puddle pulses every
// `BLAZE_PULSE` for its whole life.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Blaze"): "A Blaze
// puddle is a pulsing effect with interval `BLAZE_PULSE` (`0.2`): it pulses on
// the tick it appears and on every `BLAZE_PULSE` interval of ticks after, and
// each pulse deals `damage` to every enemy overlapping it." `specs/world.md`
// ("Timers"): "An interval of `s` seconds anywhere in this specification is
// likewise `round(s × TICK_HZ)` ticks", so the interval is `round(0.2 × 60)` =
// `12` ticks. `BLAZE_STATS` gives duration `4.0` and damage `8`, times
// multipliers of `1` with no passive held, so the puddle's `ttl` is counted down
// "by `TICK_DT`" from the tick after it appears and it is "removed when it is
// due", `round(4.0 × 60)` = `240` ticks on, at the top of phase 6 before that
// tick's hits. So the pulses fall on the tick the puddle appears and on every
// twelfth tick after while it lives: twenty pulses, at ticks `1, 13, ..., 229`
// after the pose, and none after.
//
// HOW THE PUDDLE APPEARS. Through `spawnPuddle`, which `specs/instrumentation.md`
// makes appear on the next tick exactly as a fired one: "It pulses first on the
// next tick and every `OIL_PULSE` or `BLAZE_PULSE` after". So the tick after the
// pose is the tick it appears, and the schedule is read from there. That the
// tick a FIRING creates a puddle on is itself a pulse tick is `blaze-row`'s
// weapon and this point's schedule read together.
//
// THE PROBE. A hound, posed at the puddle's center so it overlaps on every tick,
// and posed at a run clock of `POSED_TICK` (`10800`, `180` seconds) so it
// outlives the whole schedule: `specs/enemies.md` scales a spawn's `maxHp` by
// `hpMul(time) = 1 + HP_SCALE_PER_MINUTE (0.15) × floor(time / 60)`, and
// `spawnEnemy` scales a posed enemy "by the run clock exactly as a director
// spawn is" (`specs/instrumentation.md`), so at `180` seconds a hound spawns with
// `120 × 1.45` = `174` hp against the `20 × 8` = `160` the twenty pulses remove.
// That it has health for all twenty is read as a precondition of the pose.
// Nothing on the posed clock runs: the events, the spawns, and the despawns are
// switched off, and dawn is `25000` ticks away.
//
// THE POSE. An isolated night, the clock posed, a hound at `(200, 0)`, a level-1
// Blaze puddle posed at the same point, and `weaponFire` on so the pulses run —
// while it is off "nothing fires or pulses" (`specs/instrumentation.md`). No
// weapon is held, so `weaponFire` fires nothing of its own, and every other
// faculty is held, so the hound stands under the puddle and lands no contact.
//
// TOLERANCE. None on the ticks: the schedule is fixed to the tick by the timer
// rule. A fall in `hp` is read as any decrease, so the reading is the schedule
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { BLAZE_PULSE, dueTicks, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemy,
  placePuddle,
  type Harness,
} from "../harness";

/** Blaze's fixed row, `BLAZE_STATS`. */
const ROW = weaponRow("blaze");

/** Where the puddle and the hound both stand: off the lamplighter. */
const AT = { x: 200, y: 0 };

/** The interval between pulses, in ticks: `round(0.2 × 60)` = `12`. */
const INTERVAL = dueTicks(BLAZE_PULSE);

/** The ticks the puddle lives before its ttl is due: `round(4.0 × 60)` = `240`. */
const LIFE = dueTicks(ROW.duration as number);

/** The ticks after the pose on which the puddle pulses: `1, 13, ..., 229`. */
const PULSE_TICKS = (() => {
  const ticks: number[] = [];
  for (let tick = 1; tick < LIFE; tick += INTERVAL) ticks.push(tick);
  return ticks;
})();

/** The clock the night is posed at: `180` seconds, so a hound spawns with `174` hp. */
const POSED_TICK = 10800;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lowers a hound's hp on the tick the puddle appears and on every 12th tick after while it lives", async () => {
  await isolate(h);
  await h.debug.setTick(POSED_TICK);
  const hound = await placeEnemy(h, "hound", AT.x, AT.y);
  assertGreaterThan(
    hound.hp,
    PULSE_TICKS.length * ROW.damage,
    `the posed hound's hp against the ${PULSE_TICKS.length} pulses of ${ROW.damage} it must survive`,
  );
  await placePuddle(h, "blaze", AT.x, AT.y);
  await enable(h, "weaponFire");

  const pulses = await captureReplay(h, "pulses", async () => {
    let previous = hound.hp;
    const damagedOn: number[] = [];
    let present = true;
    const ticks = await h.stepWatching(LIFE, (snapshot, tick) => {
      const now = enemyById(snapshot, hound.id);
      if (now === undefined) {
        damagedOn.push(tick);
        present = false;
        return true;
      }
      if (now.hp < previous) damagedOn.push(tick);
      previous = now.hp;
      return false;
    });
    return { damagedOn, present, stepped: ticks.length };
  });

  assertEqual(
    pulses.present,
    true,
    "the hound alive through the puddle's life",
  );
  assertEqual(pulses.stepped, LIFE, "ticks stepped through the puddle's life");
  assertDeepEqual(
    pulses.damagedOn,
    PULSE_TICKS,
    "the ticks after the pose on which the hound's hp fell",
  );
});
