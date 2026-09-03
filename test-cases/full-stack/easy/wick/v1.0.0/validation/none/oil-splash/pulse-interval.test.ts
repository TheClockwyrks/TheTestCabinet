// Wick — oil-splash/pulse-interval: a puddle pulses every `OIL_PULSE`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "A
// puddle is a pulsing effect with interval `OIL_PULSE` (`0.3`): it pulses on
// the tick it appears and on every `OIL_PULSE` interval of ticks after, and
// each pulse deals `damage` to every enemy overlapping it." `specs/world.md`
// ("Timers"): "An interval of `s` seconds anywhere in this specification is
// likewise `round(s × TICK_HZ)` ticks", so the interval is `round(0.3 × 60)`
// = `18` ticks. The puddle's life: its `ttl` is the row's duration, `2.5`,
// counted down "by `TICK_DT`" from the tick after it appears and "removed
// when it is due", `round(2.5 × 60)` = `150` ticks on, at the top of phase 6,
// before that tick's hits. So the pulses fall on the tick the puddle appears
// and on every eighteenth tick after it while it lives: nine pulses, the
// ninth `144` ticks after the first, and none after, since the tenth would
// fall past the `150th` tick, by which the puddle's duration has run out.
// That the puddle goes on the `150th` is `puddle-duration`'s point, so it is
// not asserted here.
//
// HOW THE PUDDLE APPEARS. It is posed through `spawnPuddle`, which
// `specs/instrumentation.md` makes appear on the next tick exactly as a fired
// one: "It pulses first on the next tick and every `OIL_PULSE` or
// `BLAZE_PULSE` after", and a posed zone "first pulses on the next tick,
// exactly as one a tick created". So the tick after the pose is the tick it
// appears, and the schedule is read from there. That the tick a FIRING
// creates a puddle on is a pulse tick is `pulses-on-appearance`'s point.
//
// WHAT IS READ. The enemy's `hp` on each of `150` ticks after the pose,
// against the tick before it: the ticks on which it fell are the pulse ticks,
// and they are exactly `1, 19, 37, ..., 145`. A hound is the probe rather than
// a moth, because a moth's `5` hp does not outlive a second pulse of `4` and
// a puddle that pulses on the wrong tick would read as a death rather than
// as a tick; the hound's `120` hp outlives all nine. It stands at the puddle's
// center, distance `0`, so it overlaps on every tick.
//
// THE POSE. An isolated night, a hound at `(200, 0)`, and a level-1 puddle
// posed at the same point, with `weaponFire` on so the pulses run (while it
// is off "nothing fires or pulses", `specs/instrumentation.md`) and every
// other faculty held, so the hound stands where it was posed and lands no
// contact. No weapon is held, so `weaponFire` fires nothing.
//
// TOLERANCE. None on the ticks: the schedule is fixed to the tick by the
// timer rule, and a build a tick out has broken it. A fall in `hp` is read as
// any decrease, so the reading is the schedule alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { dueTicks, OIL_PULSE, weaponRow } from "../constants";
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
import { OIL } from "./stage";

/** Where the puddle and the hound both stand: off the lamplighter. */
const AT = { x: 200, y: 0 };

/** The interval between pulses, in ticks: `round(0.3 × 60)` = `18`. */
const INTERVAL = dueTicks(OIL_PULSE);

/** The ticks the level-1 puddle lives before it is due: `round(2.5 × 60)` = `150`. */
const LIFE = dueTicks(weaponRow(OIL, 1).duration ?? NaN);

/** The ticks after the pose on which the puddle pulses: `1, 19, ..., 145`. */
const PULSE_TICKS = (() => {
  const ticks: number[] = [];
  for (let tick = 1; tick < LIFE; tick += INTERVAL) ticks.push(tick);
  return ticks;
})();

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lowers a hound's hp on the tick the puddle appears and on every 18th tick after while it lives", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", AT.x, AT.y);
  await placePuddle(h, OIL, AT.x, AT.y);
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
