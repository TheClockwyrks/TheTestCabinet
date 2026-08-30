// Shatter — the rocks: how they drift, how they come apart, and what the star
// does with one it swallows.
//
// A rock is a pulled body, so the well curves it continuously and its
// instantaneous speed varies from the base drift speed it entered with. Its
// drawn rotation is cosmetic: it changes neither the velocity nor the collision,
// so a rock under no force but the well moves exactly along the path the well
// and its own momentum give it.

import type { FrameCues } from "./audio";
import {
  FIELD_H,
  FIELD_W,
  ROCK_CHILD,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  SCORE_LARGE,
  SCORE_MEDIUM,
  SCORE_SMALL,
  STAR_X,
  STAR_Y,
  TICK_DT,
  WAVE_BASE_ROCKS,
  WAVE_MIN_SHIP_DIST,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
  type RockSize,
} from "./constants";
import { addRockTo } from "./entities";
import { addScore } from "./flow";
import type { RockState, ShatterState } from "./game";
import { TAU, wrapX, wrapY, wrappedDistance } from "./geometry";
import { applyGravity } from "./gravity";
import { recordMove, type MoveTable } from "./motion";
import { nextAngle, nextFloat, nextIndex, nextRange } from "./rng";
import {
  RECYCLE_MARGIN,
  RECYCLE_SPREAD,
  SPIN_RATE_MAX,
  WAVE_PLACE_TRIES,
} from "./tuning";

/** What destroying a rock of each size pays (`specs/scoring.md`). */
const SCORE_BY_SIZE: Readonly<Record<RockSize, number>> = {
  large: SCORE_LARGE,
  medium: SCORE_MEDIUM,
  small: SCORE_SMALL,
};

/**
 * How fast a rock's drawn rotation turns, in radians per second.
 *
 * It is a function of the rock's id alone, so it is stable for the life of the
 * rock and costs the seeded generator nothing. The rotation itself is drawn from
 * that generator when the rock is created; only its rate is derived here.
 */
export function spinRateOf(id: number): number {
  const hash = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return ((hash / 4294967296) * 2 - 1) * SPIN_RATE_MAX;
}

/** Steps 2 to 5 for every rock: the pull, the move, the wrap, and the spin. */
export function integrateRocks(state: ShatterState, moves: MoveTable): void {
  for (const rock of state.rocks) {
    applyGravity(rock, TICK_DT);

    const mx = rock.vx * TICK_DT;
    const my = rock.vy * TICK_DT;
    rock.x = wrapX(rock.x + mx);
    rock.y = wrapY(rock.y + my);
    recordMove(moves, rock, mx, my);

    rock.spin = (rock.spin + spinRateOf(rock.id) * TICK_DT) % TAU;
  }
}

/**
 * Destroy a rock: it scores, it leaves the roster, and it leaves two fragments
 * of the size below behind — none, for a Small.
 *
 * Each fragment appears at the destroyed rock's position carrying the rock's own
 * velocity, plus a kick of `kickSpeed` along `kickX`/`kickY`, the two of them
 * kicked to opposite sides. What that direction is depends on what destroyed it,
 * and `src/collision.ts` decides it there.
 */
export function destroyRock(
  state: ShatterState,
  rock: RockState,
  kickX: number,
  kickY: number,
  kickSpeed: number,
  cues: FrameCues,
): void {
  const index = state.rocks.indexOf(rock);
  if (index < 0) return;
  state.rocks.splice(index, 1);

  cues.shatter = true;
  addScore(state, SCORE_BY_SIZE[rock.size], cues);

  const child = ROCK_CHILD[rock.size];
  if (child === null) return;

  for (const side of [1, -1]) {
    const fragment = addRockTo(state, child, rock.x, rock.y);
    fragment.vx = rock.vx + kickX * kickSpeed * side;
    fragment.vy = rock.vy + kickY * kickSpeed * side;
  }
}

/**
 * The star swallows a rock: the same rock relocated, not a fresh one.
 *
 * It re-enters at a random point on one of the four edges, heading inward, at a
 * fresh base drift speed drawn from its size's range. Its speed is reset and its
 * health is not, so the damage it carried comes back with it.
 */
export function recycleRock(state: ShatterState, rock: RockState): void {
  const edge = nextIndex(state, 4);
  const along = nextFloat(state);
  const speed = nextRange(
    state,
    ROCK_SPEED_MIN[rock.size],
    ROCK_SPEED_MAX[rock.size],
  );
  const spread = (nextFloat(state) - 0.5) * 2 * RECYCLE_SPREAD;

  let x = 0;
  let y = 0;
  let inward = 0;
  switch (edge) {
    case 0:
      x = RECYCLE_MARGIN;
      y = along * FIELD_H;
      inward = 0;
      break;
    case 1:
      x = FIELD_W - RECYCLE_MARGIN;
      y = along * FIELD_H;
      inward = Math.PI;
      break;
    case 2:
      x = along * FIELD_W;
      y = RECYCLE_MARGIN;
      inward = Math.PI / 2;
      break;
    default:
      x = along * FIELD_W;
      y = FIELD_H - RECYCLE_MARGIN;
      inward = -Math.PI / 2;
      break;
  }

  const heading = inward + spread;
  rock.x = wrapX(x);
  rock.y = wrapY(y);
  rock.vx = Math.cos(heading) * speed;
  rock.vy = Math.sin(heading) * speed;
}

/**
 * Where one rock of a wave is placed: at least `WAVE_MIN_SHIP_DIST` from the
 * ship and `WAVE_MIN_STAR_DIST` from the star, both by shortest wrapped
 * separation. The draw is repeated until it clears both; the best of the tries
 * stands in for the vanishingly rare case where none does, so the placement is
 * always decided and always deterministic.
 */
function placeWaveRock(state: ShatterState): { x: number; y: number } {
  let bestX = 0;
  let bestY = 0;
  let bestClearance = -Infinity;

  for (let attempt = 0; attempt < WAVE_PLACE_TRIES; attempt += 1) {
    const x = nextFloat(state) * FIELD_W;
    const y = nextFloat(state) * FIELD_H;
    const fromShip =
      wrappedDistance(x, y, state.ship.x, state.ship.y) - WAVE_MIN_SHIP_DIST;
    const fromStar = wrappedDistance(x, y, STAR_X, STAR_Y) - WAVE_MIN_STAR_DIST;
    const clearance = Math.min(fromShip, fromStar);
    if (clearance >= 0) return { x, y };
    if (clearance > bestClearance) {
      bestClearance = clearance;
      bestX = x;
      bestY = y;
    }
  }

  return { x: bestX, y: bestY };
}

/** The base drift speed a Large of wave `wave` enters at, scaled by the wave. */
function waveSpeedFactor(wave: number): number {
  return 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (wave - 1));
}

/**
 * Put wave `state.wave` on the field: `WAVE_BASE_ROCKS + N` Large rocks, each
 * placed clear of the ship and the star and set drifting in a random direction
 * at its size's base speed, scaled by the wave.
 */
export function spawnWave(state: ShatterState): void {
  const wave = state.wave;
  const factor = waveSpeedFactor(wave);
  const count = WAVE_BASE_ROCKS + wave;

  for (let index = 0; index < count; index += 1) {
    const spot = placeWaveRock(state);
    const rock = addRockTo(state, "large", spot.x, spot.y);
    const heading = nextAngle(state);
    const speed =
      nextRange(state, ROCK_SPEED_MIN.large, ROCK_SPEED_MAX.large) * factor;
    rock.vx = Math.cos(heading) * speed;
    rock.vy = Math.sin(heading) * speed;
  }
}
