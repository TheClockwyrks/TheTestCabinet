// Wick — evolutions/blaze-pulse-interval: a Blaze puddle pulses on the tick it
// appears and every `BLAZE_PULSE` after, for its life.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Blaze"): "A Blaze puddle is a pulsing effect with
//     interval `BLAZE_PULSE` (`0.2`): it pulses on the tick it appears and on
//     every `BLAZE_PULSE` interval of ticks after, and each pulse deals
//     `damage` to every enemy overlapping it." The fixed row has damage `8`,
//     cooldown `2.0`, radius `70`, and duration `4.0`.
//   - `specs/weapons.md` ("Persistent effects"): "A pulsing effect ... damages
//     every enemy overlapping it on each pulse tick, and the interval is the
//     time between pulses."
//   - `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in this
//     specification is likewise `round(s × TICK_HZ)` ticks", so the pulses fall
//     12 ticks apart, the puddle's 4.0 seconds are 240 ticks, and Blaze's
//     `2.0`-second timer is next due 120 ticks after the firing.
//   - `specs/instrumentation.md` (`setEnemyHp`): "Sets enemy `id`'s `hp` to
//     `hp`, a real number above `0` and at most its `maxHp`"; ("The
//     operations"): a pose "sets one thing and leaves the rest of the game as
//     it stands", so restoring a probe's health between pulses decides no
//     outcome.
//
// WHAT IS READ. The landing pulse first: a moth of the lattice that overlaps a
// puddle on the firing tick is hit on it, which fixes the schedule's origin.
// Then one hound is stood on that puddle's center and followed through the 119
// ticks that follow the firing, its health restored after every tick it fell
// on, and the reading is the list of ticks after the firing on which it fell:
// exactly 12, 24, 36, 48, 60, 72, 84, 96, and 108, the multiples of 12 below
// the next firing. A build pulsing every tick, every 11 or 13, only once, or
// from a different origin produces a different list.
//
// WHY THE NIGHT IS POSED AS IT IS. A landing point is a random draw, so a
// lattice of moths covers the scatter disk for the landing pulse (see
// `blaze.ts`); after it the lattice is cleared and one hound stands exactly on
// a puddle's center, where it overlaps that puddle by 88. A hound's 120 health
// takes a pulse of 8 and, since several of the five puddles may cover the same
// point, its health is posed back to `maxHp` after every tick it fell on, a
// precondition pose that decides no outcome. Blaze alone, every driver switch
// but `weaponFire` off, so the hound stands still, nothing else hits it, and
// nothing touches the lamplighter; `weaponFire` stays on because a puddle's
// pulses are held with it, and the span stops one tick short of the next
// firing, so every pulse read belongs to the puddles this firing created.
//
// TOLERANCE. None on the tick list: the interval rule fixes each pulse to a
// whole tick through `round`, and a build a tick out has broken the stated
// rule. A health fall is any reading below the posed value.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";
import { BLAZE_PULSE, BLAZE_STATS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  present,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { armEvolved } from "./evolved";
import { blazePuddles, overlapsPuddle, poseMothLattice } from "./blaze";

/** The enemy stood on a puddle's center: HP 120, so it outlasts a pulse of 8. */
const PROBE = "hound";

/** Ticks between pulses: round(0.2 × 60) = 12. */
const PULSE_TICKS = ticksFor(BLAZE_PULSE);

/** Ticks from the firing to Blaze's next firing: round(2.0 × 60) = 120. */
const NEXT_FIRING = ticksFor(BLAZE_STATS.cooldown);

/** Ticks from the firing to the puddles' removal: round(4.0 × 60) = 240. */
const LIFE_TICKS = ticksFor(BLAZE_STATS.duration);

/** The ticks after the firing on which a pulse falls, before the next firing. */
const EXPECTED: number[] = [];
for (let tick = PULSE_TICKS; tick < NEXT_FIRING; tick += PULSE_TICKS) {
  EXPECTED.push(tick);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pulses on the firing tick and every 12 ticks after through the puddle's life", async () => {
  assertLessThan(
    NEXT_FIRING,
    LIFE_TICKS,
    "the span watched against the puddles' life, so every pulse read is theirs",
  );
  const { player } = armEvolved(h, "blaze");
  const lattice = poseMothLattice(h, player);
  const posed = h.snapshot();

  const outcome = await captureReplay(h, "pulses", async () => {
    const fired = await h.tick(1);
    const puddles = blazePuddles(fired);
    assertEqual(
      puddles.length,
      BLAZE_STATS.amount,
      "Blaze puddles after the firing tick",
    );
    const center = { x: puddles[0].x, y: puddles[0].y };
    const landingHits = lattice.filter((moth) => {
      if (!overlapsPuddle(moth.at, center)) return false;
      const before = present(enemyById(posed, moth.id), `moth ${moth.id}`);
      const after = enemyById(fired, moth.id);
      return after === undefined || after.hp < before.hp;
    });

    h.debug.clearEnemies();
    const hound = spawnEnemyAt(h, PROBE, center.x, center.y);
    let held = present(enemyById(h.snapshot(), hound), "the posed hound").hp;
    const falls: number[] = [];
    for (let tick = 1; tick < NEXT_FIRING; tick += 1) {
      const snapshot = await h.tick(1);
      const seen = present(
        enemyById(snapshot, hound),
        `the hound on tick ${tick}`,
      );
      if (seen.hp < held) {
        falls.push(tick);
        h.debug.setEnemyHp(hound, seen.maxHp);
        held = present(enemyById(h.snapshot(), hound), "the hound restored").hp;
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
    "the ticks after the firing on which the hound's health fell",
  );
});
