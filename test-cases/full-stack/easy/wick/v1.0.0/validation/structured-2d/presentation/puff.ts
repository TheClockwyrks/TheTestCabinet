// presentation/puff — the one arrangement the two death-puff suites share: a
// moth about to die, on a spot of its own.
//
// NOT a check. Nothing here asserts anything or decides an outcome; the kill
// and the puff come from the tick that runs after it.
//
// HOW THE KILL IS MADE. The shortest honest path from a posed world to a death,
// the one `pickups/roll` takes for its sample: a level-1 Oil Splash puddle
// posed on the moth's own centre overlaps it certainly, "pulses first on the
// next tick" whatever the driver switches hold, and "each pulse deals `damage`
// to every enemy overlapping it" (`specs/instrumentation.md`, `spawnPuddle`;
// `specs/weapons.md`, Oil Splash). The moth's `hp` is posed to that row's `4`
// with `setEnemyHp`, so the next tick takes it to `0` and the death is that
// tick's — which `specs/assets.md` makes the tick the puff's `t` counts from.
//
// WHERE THE MOTH STANDS. 300 units from the lamplighter along `x` and 160 along
// `y`: well inside the `1280 x 720` view, far from the stage centre where the
// lamplighter's own sprite is drawn, and far outside `pickupRadius` (`48` with
// no Lure held) and the collection distance, so the gem the death drops lies
// where it fell and nothing is attracted or collected while the puff plays.
// `enemyMotion` is off throughout, so the moth is standing exactly there when
// it dies and the puff's spot is known before the kill.

import { OIL_SPLASH_LEVELS } from "../constants";
import { isolate, placeEnemy, placePuddle, type Harness } from "../harness";

/** A level-1 Oil Splash puddle's damage, `4`, with no Wick held. */
export const PULSE_DAMAGE = OIL_SPLASH_LEVELS[0].damage;

/** Where the moth stands, and so where it dies. */
export const DEATH_AT = { x: 300, y: 160 };

/**
 * Pose an isolated world holding one moth at {@link DEATH_AT} with a puddle
 * over it and just enough health to be killed by that puddle's first pulse, so
 * the NEXT tick is the tick it dies on.
 */
export function poseDoomedMoth(h: Harness): number {
  isolate(h);
  const id = placeEnemy(h, "moth", DEATH_AT.x, DEATH_AT.y);
  h.debug.setEnemyHp(id, PULSE_DAMAGE);
  placePuddle(h, "oil-splash", DEATH_AT.x, DEATH_AT.y);
  return id;
}
