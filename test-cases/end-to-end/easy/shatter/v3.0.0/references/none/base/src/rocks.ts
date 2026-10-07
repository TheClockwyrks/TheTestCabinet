// Shatter — the rocks: how one moves, how one comes apart, and what the star does
// with one it swallows.
//
// `specs/rocks.md` fixes the sizes, the split and the recycle;
// `specs/collision.md` fixes the fan a destroyed rock's fragments are thrown on;
// `specs/scoring.md` fixes what each destruction pays.
//
// The one thing to keep straight is what "destroyed" means. A rock the star
// swallows is NOT destroyed — it is relocated — and a rock removed through the
// debug surface is not destroyed either. That distinction is what the wave loop
// stands on (`src/waves.ts`), which is why {@link destroyRock} is the only thing
// in the build that raises `rockDestroyed`.

import { CUES, ROCK_CHILD, ROCK_SCORE, SPLIT_KICK, TICK_DT } from "./constants";
import { makeRock } from "./entities";
import { pull, travel } from "./motion";
import type { ShatterState } from "./types";
import { addScore, raise } from "./world";

/** One tick for every rock: pulled, moved, wrapped and spun. */
export function integrateRocks(state: ShatterState): void {
  for (const rock of state.rocks) {
    pull(rock, TICK_DT);
    travel(rock, TICK_DT);
    // Cosmetic, and deliberately kept out of everything above: the spin turns
    // what is DRAWN and never what moves.
    rock.angle += rock.spin * TICK_DT;
  }
}

/**
 * Destroy the rock at `index`: pay for it, take it off the field, and leave two
 * fragments of the size below thrown to opposite sides of `axis` at
 * `SPLIT_KICK`.
 *
 * Both fragments appear at the destroyed rock's position carrying its velocity,
 * plus the kick, and are appended to the roster in order with fresh ids
 * (`specs/rocks.md`). A Small leaves nothing.
 */
export function destroyRock(
  state: ShatterState,
  index: number,
  axis: number,
): void {
  const rock = state.rocks[index];
  addScore(state, ROCK_SCORE[rock.size]);
  state.rocks.splice(index, 1);

  const child = ROCK_CHILD[rock.size];
  if (child !== null) {
    const kx = Math.cos(axis) * SPLIT_KICK;
    const ky = Math.sin(axis) * SPLIT_KICK;
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
 * A bullet reached the rock at `index`, which destroys it
 * (`specs/collision.md`).
 *
 * The fan is thrown across the BULLET's travel rather than the rock's course, so
 * it lies over the shot whatever the rock was doing.
 */
export function hitRockWithBullet(
  state: ShatterState,
  index: number,
  bulletVx: number,
  bulletVy: number,
): void {
  destroyRock(state, index, Math.atan2(bulletVy, bulletVx) + Math.PI / 2);
}
