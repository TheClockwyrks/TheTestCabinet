// Wick — oil-splash/pulse-interval: a puddle pulses every `OIL_PULSE` for
// its life, counted from the tick it appears.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Oil Splash"): "A puddle is a pulsing effect with
//     interval `OIL_PULSE` (`0.3`): it pulses on the tick it appears and on
//     every `OIL_PULSE` interval of ticks after, and each pulse deals `damage`
//     to every enemy overlapping it"; row 1 gives duration 2.5.
//   - `specs/weapons.md` ("Persistent effects"): "A pulsing effect (the Halo
//     aura and Oil Splash puddles) damages every enemy overlapping it on each
//     pulse tick, and the interval is the time between pulses."
//   - `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in
//     this specification is likewise `round(s × TICK_HZ)` ticks", so the
//     pulses fall 18 ticks apart, and the puddle's 2.5 seconds are 150 ticks,
//     the tick it "is removed" (`specs/state.md`, `ZoneState.ttl`).
//   - `specs/instrumentation.md` ("The operations"): "a posed enemy ... first
//     moves, first hits, and first pulses on the next tick"; (`setEnemyHp`):
//     "Sets enemy `id`'s `hp` to `hp`, a real number above `0` and at most
//     its `maxHp`".
//
// WHAT IS READ. The landing pulse first: a moth overlapping the puddle on the
// firing tick is hit on it, which fixes the schedule's origin. Then one moth
// is stood on the puddle's center and followed through the 149 ticks the
// puddle has left, its health posed back to full after every tick it fell on,
// so the reading is the list of ticks after the firing on which it fell:
// exactly 18, 36, 54, 72, 90, 108, 126, and 144, the multiples of 18 below
// 150. A build pulsing every tick, every 17 or 19, only once, or from a
// different origin produces a different list.
//
// WHY THE NIGHT IS POSED AS IT IS. A lattice of moths covers the scatter disk
// for the landing pulse, since the landing point is a random draw (see
// `puddle.ts`); after it the lattice is cleared and one moth stands exactly on
// the center, where it overlaps the puddle by 60. A moth's 5 health takes one
// pulse of 4 and would die on the second, so its health is posed back to
// `maxHp` after each hit, a precondition pose that decides no outcome. Oil
// Splash alone at level 1, so one puddle; every switch but `weaponFire` off,
// so the moth stands still, nothing else hits it, and nothing touches the
// lamplighter. Oil Splash's next firing, at 180 ticks, falls after the trace.
//
// TOLERANCE. None on the tick list: the rule fixes each pulse to a whole tick
// through `round`, and a build a tick out has broken the stated rule. A health
// fall is any reading below the posed value.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";
import { OIL_PULSE, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  present,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import {
  PULSE_ENEMY,
  armOilSplash,
  oilRow,
  overlapsPuddle,
  poseMothLattice,
  puddlesOf,
} from "./puddle";

/** The level held: one puddle of radius 50, damage 4, and duration 2.5. */
const LEVEL = 1;
const ROW = oilRow(LEVEL);

/** Ticks between pulses: round(0.3 × 60) = 18. */
const PULSE_TICKS = ticksFor(OIL_PULSE);

/** Ticks from the firing to the puddle's removal: round(2.5 × 60) = 150. */
const LIFE_TICKS = ticksFor(ROW.duration);

/** The ticks after the firing on which a pulse falls: 18, 36, ..., 144. */
const EXPECTED: number[] = [];
for (let tick = PULSE_TICKS; tick < LIFE_TICKS; tick += PULSE_TICKS) {
  EXPECTED.push(tick);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pulses on the firing tick and every 18 ticks after through the puddle's life", async () => {
  assertLessThan(
    LIFE_TICKS,
    ticksFor(ROW.cooldown),
    "the puddle's life against Oil Splash's cooldown, so no second firing joins the trace",
  );
  const { player } = armOilSplash(h, LEVEL);
  const lattice = poseMothLattice(h, player);
  const posed = h.snapshot();

  const outcome = await captureReplay(h, "pulses", async () => {
    const fired = await h.tick(1);
    const puddles = puddlesOf(fired);
    assertEqual(puddles.length, 1, "Oil Splash puddles after the firing tick");
    const puddle = puddles[0];
    const center = { x: puddle.x, y: puddle.y };
    const landingHits = lattice.filter((moth) => {
      if (!overlapsPuddle(moth.at, center, ROW.radius)) return false;
      const before = present(enemyById(posed, moth.id), `moth ${moth.id}`);
      const after = present(enemyById(fired, moth.id), `moth ${moth.id}`);
      return after.hp < before.hp;
    });

    h.debug.clearEnemies();
    const moth = spawnEnemyAt(h, PULSE_ENEMY, center.x, center.y);
    let held = present(enemyById(h.snapshot(), moth), "the posed moth").hp;
    const falls: number[] = [];
    for (let tick = 1; tick < LIFE_TICKS; tick += 1) {
      const snapshot = await h.tick(1);
      const seen = present(
        enemyById(snapshot, moth),
        `the moth on tick ${tick}`,
      );
      if (seen.hp < held) {
        falls.push(tick);
        h.debug.setEnemyHp(moth, seen.maxHp);
        held = present(enemyById(h.snapshot(), moth), "the moth restored").hp;
      } else {
        held = seen.hp;
      }
    }
    return { landingHits, falls };
  });

  assertGreaterThan(
    outcome.landingHits.length,
    0,
    "moths overlapping the puddle that were hit on the firing tick",
  );
  assertDeepEqual(
    outcome.falls,
    EXPECTED,
    "the ticks after the firing on which the moth's health fell",
  );
});
