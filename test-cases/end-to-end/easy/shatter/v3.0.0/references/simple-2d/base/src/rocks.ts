// Shatter — the drifting rocks (`specs/rocks.md`).
//
// A rock is momentum plus the well, and nothing else: it drifts, is curved
// continuously by the star, wraps, and passes through every other rock. Two
// rules here decide how the field behaves over a whole wave:
//
//   * SPLITTING is the only thing that reduces the number of rocks. A Large
//     leaves two Medium, a Medium two Small, and a Small leaves nothing, both
//     fragments appearing at the destroyed rock's position with fresh ids
//     appended in order.
//   * STAR RECYCLING is a relocation rather than a removal. A rock the core
//     swallows comes back at the same size from an edge, heading inward at a
//     fresh base drift speed, so the field's rock count is unchanged and the
//     well stirs the board without ever emptying it.
//
// The drawn spin is deliberately not a state field of its own: `spin` is the
// ANGLE, and the rate it turns at is derived from the rock's id, so it is stable
// for the rock's whole life, differs between neighbours, and cannot touch the
// simulation.

import {
  FIELD_H,
  FIELD_W,
  ROCK_CHILD,
  ROCK_RADIUS,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  SPLIT_KICK,
  type RockSize,
} from "./constants";
import { wrapX, wrapY } from "./field";
import { nextInt, nextRange } from "./rng";
import { takeId, type MutRock, type Sim } from "./sim";

/** The collision radius of a rock of that size. */
export function rockRadius(size: RockSize): number {
  return ROCK_RADIUS[size];
}

/**
 * How fast a rock of that size turns on the screen, in radians per second.
 *
 * Derived from the id rather than stored, so it is cosmetic by construction:
 * there is no field for the simulation to read it out of.
 */
export function spinRate(id: number): number {
  const wave = Math.sin(id * 12.9898) * 43758.5453;
  const fraction = wave - Math.floor(wave);
  return (0.25 + fraction * 0.75) * (id % 2 === 0 ? 1 : -1);
}

/** A base drift speed for that size, drawn uniformly from its own range. */
export function drawBaseSpeed(sim: Sim, size: RockSize): number {
  const [speed, next] = nextRange(
    sim.rngState,
    ROCK_SPEED_MIN[size],
    ROCK_SPEED_MAX[size],
  );
  sim.rngState = next;
  return speed;
}

/** Put one rock on the field, appended to the roster with a fresh id. */
export function addRock(
  sim: Sim,
  size: RockSize,
  x: number,
  y: number,
  vx: number,
  vy: number,
): MutRock {
  const id = takeId(sim);
  const rock: MutRock = {
    id,
    x: wrapX(x),
    y: wrapY(y),
    vx,
    vy,
    size,
    // A starting phase off the id, so neighbouring rocks are not in step.
    spin: (id * 0.7) % (Math.PI * 2),
  };
  sim.rocks.push(rock);
  return rock;
}

/** Advance every rock's drawn rotation. It changes nothing else. */
export function spinRocks(sim: Sim, dt: number): void {
  for (const rock of sim.rocks) {
    rock.spin = (rock.spin + spinRate(rock.id) * dt) % (Math.PI * 2);
  }
}

/**
 * Break a rock apart, appending the two fragments the size ladder gives it.
 *
 * The kick is handed in as a vector: each fragment takes the destroyed rock's
 * velocity plus that kick, the two to opposite sides, so the AVERAGE of the two
 * fragment velocities is the parent's whatever the kick was and their DIFFERENCE
 * is twice the kick with the parent's motion cancelled.
 */
export function splitRock(
  sim: Sim,
  rock: MutRock,
  kickX: number,
  kickY: number,
): void {
  const child = ROCK_CHILD[rock.size];
  if (child === null) return;
  addRock(sim, child, rock.x, rock.y, rock.vx + kickX, rock.vy + kickY);
  addRock(sim, child, rock.x, rock.y, rock.vx - kickX, rock.vy - kickY);
}

/** The kick a gun kill gives each fragment: `SPLIT_KICK` across the shot. */
export function splitKickAcross(
  bulletVx: number,
  bulletVy: number,
): readonly [number, number] {
  const speed = Math.hypot(bulletVx, bulletVy);
  if (speed === 0) return [0, SPLIT_KICK];
  // Perpendicular to the BULLET's travel, not to the rock's course.
  return [(-bulletVy / speed) * SPLIT_KICK, (bulletVx / speed) * SPLIT_KICK];
}

/**
 * The star swallows a rock: the same rock, relocated.
 *
 * It re-enters at a random point on one of the four edges, heading inward, at a
 * fresh base drift speed for its size. Its identity, its size and the field's
 * rock count are all unchanged, and nothing scores.
 */
export function recycleRock(sim: Sim, rock: MutRock): void {
  const [edge, afterEdge] = nextInt(sim.rngState, 0, 3);
  sim.rngState = afterEdge;

  const speed = drawBaseSpeed(sim, rock.size);

  if (edge === 0 || edge === 1) {
    const [y, next] = nextRange(sim.rngState, 0, FIELD_H);
    sim.rngState = next;
    rock.y = wrapY(y);
    rock.x = edge === 0 ? 0 : FIELD_W - 1;
    rock.vx = edge === 0 ? speed : -speed;
    rock.vy = 0;
    return;
  }

  const [x, next] = nextRange(sim.rngState, 0, FIELD_W);
  sim.rngState = next;
  rock.x = wrapX(x);
  rock.y = edge === 2 ? 0 : FIELD_H - 1;
  rock.vy = edge === 2 ? speed : -speed;
  rock.vx = 0;
}
