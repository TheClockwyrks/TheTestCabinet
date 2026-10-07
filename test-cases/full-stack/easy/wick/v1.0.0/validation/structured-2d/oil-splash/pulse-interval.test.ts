// oil-splash/pulse-interval — a puddle pulses every OIL_PULSE.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "A
// puddle is a pulsing effect with interval `OIL_PULSE` (`0.3`): it pulses on
// the tick it appears and on every `OIL_PULSE` interval of ticks after, and
// each pulse deals `damage` to every enemy overlapping it." `specs/world.md`
// ("Timers"): "An interval of `s` seconds anywhere in this specification is
// likewise `round(s × TICK_HZ)` ticks", so the interval is `round(0.3 × 60)`
// = 18 ticks. The level table, row 1, gives the puddle duration 2.5, and
// `specs/state.md` ("ZoneState") removes a zone "on the tick `ttl` is due",
// `round(2.5 × 60)` = 150 ticks after the firing tick (`specs/world.md`, "One
// tick", phase 6, counts down only the zones "that existed before this
// tick"). So a puddle fired at level 1 pulses on its firing tick and on the
// 18th, 36th, 54th, 72nd, 90th, 108th, 126th, and 144th tick after it, and on
// no other tick of its life.
//
// WHAT IS READ. The firing is the weapon's own, so the puddle lands where the
// weapon put it, and the moth under it is there before the firing: the moths
// of `oil-splash/firing`'s lattice cover the scatter disk, and the one
// nearest the landing point overlaps it whatever the draw ("Shapes and
// overlap": "Two circles overlap when the distance between their centers is
// less than the sum of their radii", under 57.7 against a radius-50 puddle
// and a radius-10 moth). That moth is read on the firing tick and on each of
// the 150 ticks of the puddle's life, one at a time; a tick on which its `hp`
// fell is a pulse, and the `hp` is then posed back to `maxHp` through
// `setEnemyHp` so the next pulse is read the same way and the moth, at 5 `hp`
// against a 4-damage pulse, never dies. The ticks that pulsed are compared
// whole against the nine the interval fixes, so a pulse early, late, missing,
// or extra fails by name.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding the lattice alone,
// Oil Splash at level 1 armed so exactly one puddle lands, `weaponFire` on and
// every other switch off, so the moths hold their centers and touch nothing.
// The rest of the lattice is removed through `removeEnemy` on the firing tick
// itself ("Removes enemy `id`. Nothing drops, nothing counts as a kill, and no
// cue plays", `specs/instrumentation.md`), so the puddle's life runs against
// one puddle and one moth and nothing else: no second moth reaching 0 `hp` on
// its second pulse, and nothing dropped, counted, or drawn. Oil Splash's timer
// reads its 3.0 cooldown after the firing and is next due 180 ticks later,
// past the 150 this check covers, so one puddle is the only one throughout.
//
// THE TOLERANCE. None: the ticks are fixed by the timer rule, and whether an
// `hp` fell is a comparison of two reals a pulse separates by 4.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertDefined, assertEqual } from "../assert";
import { OIL_PULSE, OIL_SPLASH_LEVELS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  type Harness,
} from "../harness";
import {
  LATTICE_CIRCUMRADIUS,
  coverScatterDisk,
  fireFromPosed,
  mothOverlap,
  nearestEnemy,
} from "./firing";

/** Level 1 of Oil Splash: one puddle a firing, radius 50, damage 4, duration 2.5. */
const LEVEL = 1;
const ROW = OIL_SPLASH_LEVELS[LEVEL - 1];

/** The distance under which a moth's circle overlaps a level-1 puddle's. */
const OVERLAP = mothOverlap(ROW.radius);

/** The pulse interval in ticks: `round(0.3 × 60)` = 18. */
const INTERVAL = ticksOf(OIL_PULSE);

/** The puddle's life in ticks: `round(2.5 × 60)` = 150 after the firing tick. */
const LIFE = ticksOf(ROW.duration);

/**
 * The ticks, counted from the firing tick, on which the puddle pulses: 0, 18,
 * ..., 144. The puddle is gone on tick 150, before another is due.
 */
const PULSES: readonly number[] = Array.from(
  { length: Math.ceil(LIFE / INTERVAL) },
  (_, k) => k * INTERVAL,
).filter((tick) => tick < LIFE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("damages a moth under a fired puddle on the firing tick and on every 18th tick after, through the puddle's life", async () => {
  if (!(LATTICE_CIRCUMRADIUS < OVERLAP)) {
    throw new Error("the lattice must put a moth under every landing point");
  }
  isolate(h);
  const ids = coverScatterDisk(h);
  const posed = h.snapshot();
  assertEqual(
    posed.run.enemies.length,
    ids.length,
    "moths in the world after the lattice was posed (specs/instrumentation.md, spawnEnemy)",
  );

  const firing = await fireFromPosed(h, LEVEL);
  assertEqual(
    firing.puddles.length,
    ROW.amount,
    `the puddles the firing tick created at level ${LEVEL} (specs/weapons.md, Oil Splash)`,
  );
  const puddle = firing.puddles[0];
  assertDefined(
    puddle,
    "the puddle the firing tick created (specs/weapons.md, Oil Splash)",
  );
  const under = nearestEnemy(posed.run.enemies, puddle);
  if (!(under.reach < OVERLAP)) {
    throw new Error(
      `the lattice left the nearest moth ${under.reach} from the puddle's center`,
    );
  }
  const moth = under.enemy.id;
  const struck = enemyById(firing.after, moth);
  assertDefined(
    struck,
    `moth ${moth}, the one under the puddle, after the firing tick`,
  );
  const full = under.enemy.maxHp;

  // The firing tick's own reading, then the field cleared down to that moth.
  const firstPulse = (struck?.hp ?? NaN) < full;
  h.debug.setEnemyHp(moth, full);
  for (const id of ids) if (id !== moth) h.debug.removeEnemy(id);
  assertEqual(
    h.snapshot().run.enemies.length,
    1,
    "moths left in the world for the puddle's life (specs/instrumentation.md, removeEnemy)",
  );

  const pulsed = await captureReplay(h, "pulses", async () => {
    const ticks: number[] = firstPulse ? [0] : [];
    for (let tick = 1; tick <= LIFE; tick += 1) {
      const s = await advanceTicks(h, 1);
      const seen = enemyById(s, moth);
      assertDefined(
        seen,
        `the moth in enemies on tick ${tick} after the firing`,
      );
      if ((seen?.hp ?? NaN) < full) {
        ticks.push(tick);
        h.debug.setEnemyHp(moth, full);
      }
    }
    return ticks;
  });

  assertDeepEqual(
    pulsed,
    PULSES,
    `the ticks from the firing on which the moth under the puddle took damage, over the puddle's ${LIFE}-tick life (specs/weapons.md, Oil Splash)`,
  );
});
