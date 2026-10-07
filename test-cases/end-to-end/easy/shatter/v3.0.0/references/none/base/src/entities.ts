// Shatter — building the things on the field.
//
// Every body in the game is created here and nowhere else, which is what makes
// two rules the specification states easy to hold to:
//
//   * IDENTITY. Every rock, bullet and saucer bullet carries an id distinct among
//     the entities live at that moment, and the saucer carries one too so one
//     visit is distinguishable from the next (`specs/instrumentation.md`). One
//     counter on the state hands them out and never goes backwards, so an id is
//     never reused while anything holds it.
//   * POSED DRAWS. Every draw `specs/simulation.md` lists — a rock's drift, the
//     edge and point a recycled rock re-enters at, the saucer's edge, row and
//     weave direction — is made here from the build's own source (`src/rng.ts`),
//     and where the debug surface has posed the outcome the pose is taken in its
//     place and consumed (`specs/instrumentation.md`).
//
// Nothing here steps anything: these are constructors, and how a body then
// behaves is in the system that owns it.

import {
  BULLET_LIFE,
  FACE_UP,
  FIELD_H,
  FIELD_W,
  ROCK_RADIUS,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  SAFE_X,
  SAFE_Y,
  SAUCER_BULLET_LIFE,
  SAUCER_FIRE_INTERVAL,
  SAUCER_R,
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
  TAU,
  type RockSize,
} from "./constants";
import { random, range, rangeInt, sign } from "./rng";
import type {
  Bullet,
  EnemyBullet,
  FieldEdge,
  Rock,
  Saucer,
  ShatterState,
  Ship,
  Vec,
} from "./types";

/**
 * How far ahead of the ship's centre the gun leaves from.
 *
 * `specs/weapons.md` bounds this rather than fixing it: a shot leaves the nose,
 * "ahead of the ship's centre along its facing, and no further from it than
 * `SHIP_R` (14)". Twelve puts the muzzle at the drawn nose and comfortably inside
 * the bound.
 */
export const NOSE_OFFSET = 12;

/** Everything an entity factory needs off the state: the ids. */
type Source = Pick<ShatterState, "nextId">;

/** What a placement the debug surface can pose reads off the state. */
type Posed = Pick<
  ShatterState,
  | "nextId"
  | "nextSaucerEdge"
  | "nextSaucerRow"
  | "nextRockSpeed"
  | "nextRecycleEdge"
>;

/** The next unused id, advancing the counter. Never reused within a game. */
export function takeId(source: Source): number {
  source.nextId += 1;
  return source.nextId;
}

// ---- The ship ------------------------------------------------------------

/** A ship at the safe point, at rest, facing up, with nothing running on it. */
export function makeShip(): Ship {
  return {
    x: SAFE_X,
    y: SAFE_Y,
    vx: 0,
    vy: 0,
    angle: FACE_UP,
    thrusting: false,
    invuln: 0,
    collision: true,
    fireCooldown: 0,
  };
}

/**
 * Return a ship to the safe point at rest facing up, as a life begins
 * (`specs/progression.md`). The gates it carries are left alone: whether its
 * contact test runs is the caller's business, not the respawn's.
 */
export function placeAtSafePoint(ship: Ship): void {
  ship.x = SAFE_X;
  ship.y = SAFE_Y;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = FACE_UP;
  ship.thrusting = false;
}

/** The point a shot leaves from: the nose, along the current facing. */
export function shipNose(ship: Ship): Vec {
  return {
    x: ship.x + Math.cos(ship.angle) * NOSE_OFFSET,
    y: ship.y + Math.sin(ship.angle) * NOSE_OFFSET,
  };
}

// ---- Rocks ---------------------------------------------------------------

/**
 * An irregular angular outline: per-vertex radii jittered around the collision
 * radius, so a rock reads as tumbling debris while colliding as a clean circle.
 */
function makeOutline(radius: number): number[] {
  const count = rangeInt(9, 12);
  const verts: number[] = [];
  for (let i = 0; i < count; i += 1) {
    verts.push(radius * range(0.78, 1.12));
  }
  return verts;
}

/** One rock of `size`, with a drawn spin of its own. */
export function makeRock(
  source: Source,
  size: RockSize,
  x: number,
  y: number,
  vx: number,
  vy: number,
): Rock {
  const radius = ROCK_RADIUS[size];
  return {
    id: takeId(source),
    x,
    y,
    vx,
    vy,
    size,
    radius,
    angle: range(0, TAU),
    spin: range(-1, 1),
    verts: makeOutline(radius),
  };
}

/**
 * A rock drifting from `(x, y)` on a random heading at a base drift speed,
 * scaled by the wave's multiplier (`specs/progression.md`).
 *
 * The base speed is `base` where the caller holds a posed one, and otherwise the
 * draw from the size's own range (`specs/rocks.md`).
 */
export function driftRock(
  source: Source,
  size: RockSize,
  x: number,
  y: number,
  speedScale: number,
  base: number | null = null,
): Rock {
  const speed =
    (base ?? range(ROCK_SPEED_MIN[size], ROCK_SPEED_MAX[size])) * speedScale;
  const heading = range(0, TAU);
  return makeRock(
    source,
    size,
    x,
    y,
    Math.cos(heading) * speed,
    Math.sin(heading) * speed,
  );
}

/**
 * Relocate the rock the star swallowed to an edge, in place.
 *
 * The SAME rock rather than a fresh one (`specs/rocks.md`), which is why this
 * mutates rather than building one: the id, the size and the drawn outline all
 * come across. Only its position and its speed are new — a fresh base drift speed
 * for its size, with no wave scaling, so a rock slung through the star over and
 * over never accelerates.
 *
 * It re-enters at a random point on one of the four edges, heading into the
 * field. The edge and the base speed are the posed ones where the debug surface
 * has posed them, and each pose taken is consumed.
 */
export function recycleRock(source: Posed, rock: Rock): void {
  const speed =
    source.nextRockSpeed ??
    range(ROCK_SPEED_MIN[rock.size], ROCK_SPEED_MAX[rock.size]);
  source.nextRockSpeed = null;
  // Within a third of a turn either side of straight in, so it always heads into
  // the field from the edge it entered at.
  const spread = range(-Math.PI / 3, Math.PI / 3);
  const along = Math.cos(spread) * speed;
  const across = Math.sin(spread) * speed;
  const edge = source.nextRecycleEdge ?? FIELD_EDGES[rangeInt(0, 3)];
  source.nextRecycleEdge = null;
  if (edge === "left") {
    rock.x = 0;
    rock.y = range(0, FIELD_H);
    rock.vx = along;
    rock.vy = across;
  } else if (edge === "right") {
    rock.x = FIELD_W;
    rock.y = range(0, FIELD_H);
    rock.vx = -along;
    rock.vy = across;
  } else if (edge === "top") {
    rock.x = range(0, FIELD_W);
    rock.y = 0;
    rock.vx = across;
    rock.vy = along;
  } else {
    rock.x = range(0, FIELD_W);
    rock.y = FIELD_H;
    rock.vx = across;
    rock.vy = -along;
  }
}

/** The four edges, in the order a drawn index names them. */
const FIELD_EDGES: readonly FieldEdge[] = ["left", "right", "top", "bottom"];

// ---- Shots ---------------------------------------------------------------

/** One of the ship's bullets, in flight with a full life. */
export function makeBullet(
  source: Source,
  x: number,
  y: number,
  vx: number,
  vy: number,
): Bullet {
  return {
    id: takeId(source),
    x,
    y,
    vx,
    vy,
    life: BULLET_LIFE,
    trail: [{ x, y }],
  };
}

/** One saucer bullet, in flight with a full life. */
export function makeEnemyBullet(
  source: Source,
  x: number,
  y: number,
  vx: number,
  vy: number,
): EnemyBullet {
  return { id: takeId(source), x, y, vx, vy, life: SAUCER_BULLET_LIFE };
}

// ---- The saucer ----------------------------------------------------------

/**
 * A saucer on the field at `(x, y)` travelling at `vx`, with its clocks set the
 * way an arrival sets them and all three faculties running.
 *
 * Both routes onto the field build one through here: the game's own cadence and
 * the surface's `addSaucer`. The difference is only where it is put, which is why
 * the entry draw lives in {@link enterSaucer} rather than in this function.
 */
export function makeSaucer(
  source: Source,
  x: number,
  y: number,
  vx: number,
): Saucer {
  return {
    id: takeId(source),
    x,
    y,
    vx,
    // It enters with no vertical component and weaves from there
    // (`specs/saucer.md`).
    vy: 0,
    mind: true,
    gun: true,
    travel: true,
    // Down, for a saucer posed onto the field; an arrival draws its own.
    weave: 1,
    fireTimer: SAUCER_FIRE_INTERVAL,
    weaveTimer: SAUCER_WEAVE_INTERVAL,
    age: 0,
  };
}

/**
 * A saucer arriving the way the game's own cadence brings one in: at the left
 * edge or the right, each half the time, at a row drawn uniformly across the
 * field, crossing into it at cruise, with a weave direction of its own
 * (`specs/saucer.md`). A posed edge or row is taken in place of its draw and
 * consumed.
 */
export function enterSaucer(source: Posed): Saucer {
  const edge = source.nextSaucerEdge ?? (random() < 0.5 ? "left" : "right");
  source.nextSaucerEdge = null;
  const y = source.nextSaucerRow ?? range(SAUCER_R, FIELD_H - SAUCER_R);
  source.nextSaucerRow = null;
  const fromLeft = edge === "left";
  const saucer = makeSaucer(
    source,
    fromLeft ? SAUCER_R : FIELD_W - SAUCER_R,
    y,
    fromLeft ? SAUCER_SPEED : -SAUCER_SPEED,
  );
  saucer.weave = sign();
  return saucer;
}
