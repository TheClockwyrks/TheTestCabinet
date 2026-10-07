// Wick — weapons/damage-fixed-at-creation: a shape's damage is fixed when it
// is created, and a Wick level gained later leaves it as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Hits and death"): "A shape's damage per hit is
//     fixed when the shape is created, from the level and `damageMul` in force
//     on that tick, with one exception: the aura of Halo or Corona and each
//     Chandelier lantern have their damage recomputed on every tick ... A Wick
//     level gained later leaves every other live shape's damage as it was."
//   - `specs/weapons.md` ("Oil Splash"): level-1 damage `4`, radius `50`,
//     duration `2.5`; "A puddle is a pulsing effect with interval `OIL_PULSE`
//     (`0.3`) ... each pulse deals `damage` to every enemy overlapping it."
//   - `specs/instrumentation.md` (`spawnPuddle`): a posed puddle's "`damage`
//     is that row's damage times the `damageMul` in force at the call", the
//     level-1 row when Oil Splash is not held, and "It pulses first on the
//     next tick and every `OIL_PULSE` ... after."
//   - `specs/instrumentation.md` (`setPassive`): "every multiplier follow[s]
//     from the next read", so a Wick posed mid-life is a Wick level gained
//     while the puddle lives. `specs/enemies.md`: a hound has HP `120`.
//
// WHAT IS READ. The puddle's `damage` before Wick, after Wick is posed, and
// after a tick under Wick, all `4`; and the hound's hp across the pulses that
// follow the Wick pose: every tick that changed it removed exactly `4`. Reading
// the per-pulse removal as "each non-zero change is 4" rather than "hp at tick
// N is X" keeps this item about the damage carried and not about the pulse
// schedule, which is another item's.
//
// WHY THE NIGHT IS POSED AS IT IS. One puddle and one hound on its center,
// every switch off: pulses resolve whatever the switches hold, and a hound
// (120 hp) outlasts every pulse of the span. Wick 2 is posed AFTER the first
// pulse so the puddle's creation-time multiplier is `1` and the later level is
// unmistakably gained while it lives. The span is 40 ticks after the pose,
// which holds at least two more pulses at the stated 18-tick interval and stays
// well inside the puddle's 150-tick life.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each damage reading and each hp change,
// exact arithmetic on stated figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, OIL_SPLASH_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  holdPassive,
  isolate,
  present,
  spawnEnemyNear,
  spawnPuddleAt,
  zoneById,
  type Harness,
} from "../harness";

/** The puddle's damage per pulse with no Wick held at its creation. */
const DAMAGE = OIL_SPLASH_LEVELS[0].damage;

/** The Wick level gained while the puddle lives. */
const LATER_WICK = 2;

/** Where the puddle and the hound stand: along +x, clear of the lamplighter. */
const DX = 150;

/**
 * Ticks run after Wick is gained: at least two pulses at the stated 18-tick
 * interval, inside the puddle's 2.5-second life.
 */
const SPAN_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a posed puddle's damage at 4 across a Wick level gained while it lives", async () => {
  isolate(h);
  const hound = spawnEnemyNear(h, "hound", DX, 0);
  const placed = present(enemyById(h.snapshot(), hound), "the posed hound");
  const puddle = spawnPuddleAt(h, "oil-splash", placed.x, placed.y);
  const posed = present(zoneById(h.snapshot(), puddle), "the posed puddle");
  assertWithin(
    posed.damage,
    DAMAGE,
    FIGURE_TOLERANCE,
    "the puddle's damage at creation",
  );

  // The first pulse, on the tick after the pose, before any Wick is held.
  const firstPulse = await h.tick(1);
  let hp = enemyById(firstPulse, hound)?.hp ?? Number.NaN;
  assertWithin(
    hp,
    placed.hp - DAMAGE,
    FIGURE_TOLERANCE,
    "the hound's hp after the first pulse",
  );

  holdPassive(h, "wick", LATER_WICK);
  const afterWick = present(
    zoneById(h.snapshot(), puddle),
    "the puddle after Wick is posed",
  );
  assertWithin(
    afterWick.damage,
    DAMAGE,
    FIGURE_TOLERANCE,
    "the puddle's damage after Wick rose",
  );

  const trace = await h.trace(SPAN_TICKS);
  captureStill(h, "fixed");

  const removals: number[] = [];
  trace.forEach((snapshot, index) => {
    const now = enemyById(snapshot, hound)?.hp ?? Number.NaN;
    const live = present(
      zoneById(snapshot, puddle),
      `the puddle on tick ${index + 2} after the pose`,
    );
    assertWithin(
      live.damage,
      DAMAGE,
      FIGURE_TOLERANCE,
      `the puddle's damage on tick ${index + 2} after the pose`,
    );
    if (now !== hp) removals.push(hp - now);
    hp = now;
  });
  assertGreaterThan(removals.length, 0, "pulses after Wick rose");
  removals.forEach((removed, index) => {
    assertWithin(
      removed,
      DAMAGE,
      FIGURE_TOLERANCE,
      `pulse ${index + 1} after Wick rose: hp removed`,
    );
  });
});
