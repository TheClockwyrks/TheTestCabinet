// Shatter — the rocks: how one moves, how one comes apart, and what the star does
// with one it swallows.
//
// `specs/rocks.md` fixes the sizes, the split, the armor and the recycle;
// `specs/collision.md` fixes the two fans a destroyed rock's fragments are thrown
// on; `specs/scoring.md` fixes what each destruction pays.
//
// The one thing to keep straight is what "destroyed" means. A rock is destroyed
// only by the hit that takes its health to `0`, or outright by a torpedo. A rock
// the star swallows is NOT destroyed — it is relocated — and a rock removed
// through the debug surface is not destroyed either. That distinction is what the
// wave loop stands on (`src/waves.ts`), which is why {@link destroyRock} is the
// only thing in the build that raises `rockDestroyed`.

import {
  CUES,
  HIT_FLASH_TIME,
  ROCK_CHILD,
  ROCK_SCORE,
  SPLIT_KICK,
  TICK_DT,
} from "./constants";
import { makeRock } from "./entities";
import { pull, travel } from "./motion";
import type { ShatterState } from "./types";
import { addScore, raise } from "./world";

/** One tick for every rock: pulled, moved, wrapped, spun, and its flash run down. */
export function integrateRocks(state: ShatterState): void {
  for (const rock of state.rocks) {
    pull(rock, TICK_DT);
    travel(rock, TICK_DT);
    // Cosmetic, and deliberately kept out of everything above: the spin turns
    // what is DRAWN and never what moves.
    rock.angle += rock.spin * TICK_DT;
    if (rock.hitFlash > 0) {
      rock.hitFlash = Math.max(0, rock.hitFlash - TICK_DT);
    }
  }
}

/**
 * Destroy the rock at `index`: pay for it, take it off the field, and leave two
 * fragments of the size below thrown to opposite sides of `axis` at `kick`.
 *
 * Both fragments appear at the destroyed rock's position carrying its velocity,
 * plus the kick, and are appended to the roster in order with fresh ids
 * (`specs/rocks.md`). A Small leaves nothing.
 *
 * The two fans `specs/collision.md` fixes differ only in `axis` and `kick`, so
 * both callers come through here: a gun kill throws them across the bullet's
 * travel at `SPLIT_KICK`, and a torpedo kill blasts them apart along the
 * torpedo's own line at `TORPEDO_SCATTER`.
 */
export function destroyRock(
  state: ShatterState,
  index: number,
  axis: number,
  kick: number,
): void {
  const rock = state.rocks[index];
  addScore(state, ROCK_SCORE[rock.size]);
  state.rocks.splice(index, 1);

  const child = ROCK_CHILD[rock.size];
  if (child !== null) {
    const kx = Math.cos(axis) * kick;
    const ky = Math.sin(axis) * kick;
    state.rocks.push(
      makeRock(state, child, rock.x, rock.y, rock.vx + kx, rock.vy + ky),
      makeRock(state, child, rock.x, rock.y, rock.vx - kx, rock.vy - ky),
    );
  }

  raise(state, CUES.shatter);
  // The wave loop clears on the TICK A ROCK IS DESTROYED, not on an empty field
  // (`specs/progression.md`), so the transition is recorded here and nowhere
  // else.
  state.rockDestroyed = true;
}

/**
 * A bullet reached the rock at `index`.
 *
 * The rock's health falls by exactly one. While health remains the rock is not
 * destroyed, does not split and scores nothing — it flashes and carries on
 * (`specs/rocks.md`) — and only the hit that takes health to `0` destroys it,
 * throwing the fragments across the bullet's own travel.
 */
export function hitRockWithBullet(
  state: ShatterState,
  index: number,
  bulletVx: number,
  bulletVy: number,
): void {
  const rock = state.rocks[index];
  rock.health -= 1;
  if (rock.health > 0) {
    rock.hitFlash = HIT_FLASH_TIME;
    return;
  }
  // Across the BULLET's travel rather than the rock's course, so the fan lies
  // over the shot whatever the rock was doing.
  destroyRock(
    state,
    index,
    Math.atan2(bulletVy, bulletVx) + Math.PI / 2,
    SPLIT_KICK,
  );
}
