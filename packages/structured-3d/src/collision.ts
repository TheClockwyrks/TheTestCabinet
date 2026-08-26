/**
 * Collision: detection belongs to the engine, response belongs to the game.
 *
 * The engine finds the pairs, reports them with the manifold that separates
 * them, and moves nothing. A game declares what an actor collides with by
 * attaching a {@link ColliderComponent}, and reads the result from the
 * collision events and from `world.collision`.
 *
 * The pass runs once per frame, after every controller, actor, and component
 * has ticked and after the frame's timers have fired, and before the game mode
 * ticks, so a pair produced by this frame's movement is reported in this frame
 * and the mode decides the match from a settled world. A paused world runs no
 * pass — the frame driver simply does not call {@link CollisionSystem.pass}. A
 * pair is evaluated in both directions — each collider's `responses` are asked
 * for the other's `channel` — and takes the stronger of the two answers,
 * ordered `ignore` below `overlap` below `block`; a pair both sides ignore is
 * never tested. Reported pairs put the actor with the lower `id` first, and
 * `manifold.normal` points from `colliders[0]` toward `colliders[1]`.
 *
 * The geometry model, stated once because every derivation below leans on it:
 *
 * - A shape is carried into world space by the component's `worldTransform()`
 *   — the actor's transform composed with the component's `offset` — so a
 *   collider follows its actor the way a drawn component does. Orientation is
 *   part of the test: a box is an oriented box, and a capsule's axis (local
 *   +Y) rotates with the transform. Scale follows the components page's rule:
 *   a box's `size` scales per axis, a sphere's and a capsule's radius by the
 *   largest of the three scale factors' magnitudes, and a capsule's `height`
 *   by the y factor's magnitude.
 * - Two shapes collide when they *penetrate*: a pair exactly touching, with
 *   zero depth, is not reported. That keeps a floor of adjacent tiles from
 *   reporting a hit per shared face every frame.
 * - A degenerate shape — a sphere or capsule of zero radius, a box with a
 *   zero side — takes part in nothing: it cannot penetrate, so testing it
 *   would only manufacture ambiguous manifolds. A capsule of zero height is
 *   not degenerate; it collides as the sphere it is.
 * - A pair with no separating direction of its own — concentric spheres, a
 *   capsule axis meeting another dead on — reports a fixed `(1, 0, 0)` normal
 *   rather than an arbitrary one, so the report is deterministic.
 * - Box against capsule treats the capsule as its axis segment swept by its
 *   radius: the separating distance is the segment-to-box distance, found by
 *   bisecting the derivative of the (convex) squared-distance profile along
 *   the segment; a segment reaching the box's interior separates through the
 *   face nearest its deepest point, found by ternary search on the (concave)
 *   clearance profile. Both searches run a fixed iteration count, so the
 *   report is deterministic, and profile ties resolve toward the segment's
 *   start (the capsule's local −Y cap).
 *
 * Everything here mirrors the API pages under
 * `docs/engines/structured-3d/apis/` (the `collision` page, with `Shape3` and
 * the scale rules on the `components` page) — those pages are the
 * specification, and a behavior that disagrees with its page is wrong.
 */

import type { Actor } from "./actors";
import { Component, scaleShape3, type Shape3 } from "./components";
import type { Box3, Transform, Vec3 } from "./math";
import { rotateVec3 } from "./math";

/* -------------------------------------------------------------------------- */
/* The pass's events                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The three events the pass emits, with their payloads — collision's slice of
 * the engine's map, stated here so the system can be constructed and tested
 * with nothing but this module. `worlds.ts` carries the same three entries
 * inside `EngineEventMap`, word for word, and the broadcaster the engine
 * injects satisfies both.
 *
 * Internal: the game reaches these through `world.events`, never through this
 * type.
 */
export interface CollisionEventMap {
  "overlap:begin": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  "overlap:end": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  hit: {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
    manifold: Manifold;
  };
}

/* -------------------------------------------------------------------------- */
/* The contract types                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How a pair is treated: never tested, reported on its edges, or reported with
 * a manifold every frame. Ordered `ignore` below `overlap` below `block` by
 * the resolution.
 */
export type CollisionResponse = "ignore" | "overlap" | "block";

// `Shape3` — the one vocabulary a drawn primitive and a collider's volume
// share — belongs to `components.ts`, which the components page specifies, and
// is used here rather than restated, so a collider and the shape component
// beside it can never mean two different things.

/** What a {@link ColliderComponent} is constructed from. */
export interface ColliderOptions {
  shape: Shape3;
  channel?: string;
  responses?: Readonly<Record<string, CollisionResponse>>;
}

/**
 * How a blocking pair is touching: the unit direction separating the pair,
 * pointing from the first collider of the pair toward the second; how far the
 * shapes penetrate along it, in world units; and a point on the shared
 * boundary. Multiplying `normal` by `depth` gives the smallest translation
 * that separates them — the first collider moves out along `-normal`, the
 * second along `+normal`.
 */
export interface Manifold {
  normal: Vec3;
  depth: number;
  point: Vec3;
}

/** One collider a query found, with the actor that owns it. */
export interface Overlap {
  actor: Actor;
  collider: ColliderComponent;
}

/** Where a ray met a collider. */
export interface Hit {
  /** The actor the ray met. */
  actor: Actor;
  /** The collider on it the ray met. */
  collider: ColliderComponent;
  /** Where the ray meets the collider, in world units. */
  point: Vec3;
  /** The unit surface normal at `point`. */
  normal: Vec3;
  /** How far along the ray `point` lies, from the origin. */
  distance: number;
}

/**
 * Puts a query on a channel and gives it a response map, so the query is
 * filtered by the same both-directions rule a pair of colliders is, and names
 * the actors it must not see — a query from an actor names itself so it skips
 * its own colliders.
 */
export interface QueryOptions {
  channel?: string;
  responses?: Readonly<Record<string, CollisionResponse>>;
  ignore?: readonly Actor[];
}

/** The query surface reachable as `world.collision`. */
export interface CollisionWorld {
  overlaps(actor: Actor): readonly Overlap[];
  query(shape: Shape3, at: Vec3, options?: QueryOptions): readonly Overlap[];
  raycast(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    options?: QueryOptions,
  ): Hit | null;
  raycastAll(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    options?: QueryOptions,
  ): readonly Hit[];
}

/* -------------------------------------------------------------------------- */
/* ColliderComponent                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Gives its actor a shape the engine tests, positioned and oriented by the
 * component's world transform — the actor's transform composed with the
 * component's `offset`, so one actor carries several colliders at different
 * offsets.
 *
 * `shape`, `channel`, and `responses` are mutable, and the pass reads them as
 * they stand when it runs. A collider takes part in the pass while it is
 * enabled and its actor is alive; a disabled component and a destroyed actor
 * are left out.
 */
export class ColliderComponent extends Component {
  /**
   * The shape tested, in world units relative to the component's world
   * transform.
   */
  shape: Shape3;

  /** The channel this collider is on. Defaults to `"default"`. */
  channel: string;

  /**
   * Maps a channel name to how this collider answers a collider on it. An
   * unlisted channel answers `"ignore"`.
   */
  responses: Record<string, CollisionResponse>;

  constructor(options: ColliderOptions) {
    super();
    this.shape = options.shape;
    this.channel = options.channel ?? "default";
    // Copied, so a caller mutating the record it passed does not silently
    // retune a collider already in the world — and so the field is the plain
    // mutable record the class declares.
    this.responses = { ...options.responses };
  }

  /**
   * The world-axis-aligned `Box3` enclosing the shape at the component's
   * world transform, in world units.
   *
   * Unlike the pass, `bounds()` answers for a degenerate shape too — the
   * enclosing box of a zero-volume shape is a zero-sized box at its position,
   * which is still the honest answer to "where is this".
   */
  bounds(): Box3 {
    return worldBounds(worldGeometry(this.shape, this.worldTransform()));
  }
}

/* -------------------------------------------------------------------------- */
/* Response resolution                                                        */
/* -------------------------------------------------------------------------- */

/** The strength order the resolution compares by. */
const RANK: Record<CollisionResponse, number> = {
  ignore: 0,
  overlap: 1,
  block: 2,
};

/**
 * How `responses` answers `channel`: the declared response, or `"ignore"` for
 * an unlisted channel. Looked up as an own property so a channel that happens
 * to be named after an `Object.prototype` member (`"constructor"`, …) is still
 * an unlisted channel rather than a function.
 */
function answer(
  responses: Readonly<Record<string, CollisionResponse>>,
  channel: string,
): CollisionResponse {
  return Object.hasOwn(responses, channel) ? responses[channel]! : "ignore";
}

/**
 * The both-directions rule: each side answers for the other's channel, and the
 * pair takes the stronger of the two answers. One side is therefore enough to
 * establish a response, and a pair left alone must be ignored by both.
 */
function resolve(
  aChannel: string,
  aResponses: Readonly<Record<string, CollisionResponse>>,
  bChannel: string,
  bResponses: Readonly<Record<string, CollisionResponse>>,
): CollisionResponse {
  const ab = answer(aResponses, bChannel);
  const ba = answer(bResponses, aChannel);
  return RANK[ab] >= RANK[ba] ? ab : ba;
}

/* -------------------------------------------------------------------------- */
/* World-space geometry                                                       */
/* -------------------------------------------------------------------------- */

/** A sphere carried into world space. */
interface WorldSphere {
  kind: "sphere";
  center: Vec3;
  radius: number;
}

/**
 * An oriented box carried into world space: its center, its three unit axis
 * directions (the rotation applied to the local x, y, z axes), and its half
 * extent along each.
 */
interface WorldBox {
  kind: "box";
  center: Vec3;
  axes: readonly [Vec3, Vec3, Vec3];
  half: Vec3;
}

/**
 * A capsule carried into world space: the centers of its two hemispherical
 * caps (`p0` the local −Y cap, `p1` the +Y cap) and its radius. A zero-height
 * capsule has `p0 === p1` componentwise and every test below degrades to the
 * sphere it is.
 */
interface WorldCapsule {
  kind: "capsule";
  p0: Vec3;
  p1: Vec3;
  radius: number;
}

type WorldShape = WorldSphere | WorldBox | WorldCapsule;

/**
 * Below this separating distance a box–capsule pair counts as reaching the
 * box's interior, so the face rule takes over before a vanishing distance
 * turns the normal into rounding noise.
 */
const DEEP_EPSILON = 1e-9;

/**
 * Carries `shape` into world space through `transform`, degenerate or not:
 * the geometric answer to "where and how big", used by both the tests (which
 * refuse degenerates) and `bounds()` (which answers for them).
 *
 * Scale is applied by the components module's own `scaleShape3`, the one
 * statement of the documented rule, rather than restated here, so a collider
 * under a scaled actor and the shape component beside it can never disagree.
 * The magnitudes below are what remains: a mirrored scale flips nothing about
 * a centered primitive, so a negative factor is a reflection the extent does
 * not carry.
 */
function worldGeometry(shape: Shape3, transform: Transform): WorldShape {
  const scaled = scaleShape3(shape, transform.scale);
  switch (scaled.kind) {
    case "sphere":
      return {
        kind: "sphere",
        center: transform.position,
        radius: Math.abs(scaled.radius),
      };
    case "box":
      return {
        kind: "box",
        center: transform.position,
        axes: [
          rotateVec3(transform.rotation, { x: 1, y: 0, z: 0 }),
          rotateVec3(transform.rotation, { x: 0, y: 1, z: 0 }),
          rotateVec3(transform.rotation, { x: 0, y: 0, z: 1 }),
        ],
        half: {
          x: Math.abs(scaled.size.x) / 2,
          y: Math.abs(scaled.size.y) / 2,
          z: Math.abs(scaled.size.z) / 2,
        },
      };
    case "capsule": {
      // The axis is the world rotation applied to local +Y, half the scaled
      // height long, so the two cap centers sit either side of the position.
      const half = Math.abs(scaled.height) / 2;
      const along = rotateVec3(transform.rotation, { x: 0, y: half, z: 0 });
      return {
        kind: "capsule",
        p0: {
          x: transform.position.x - along.x,
          y: transform.position.y - along.y,
          z: transform.position.z - along.z,
        },
        p1: {
          x: transform.position.x + along.x,
          y: transform.position.y + along.y,
          z: transform.position.z + along.z,
        },
        radius: Math.abs(scaled.radius),
      };
    }
  }
}

/**
 * Carries `shape` into world space through `transform`, or `null` when the
 * result is degenerate — a zero radius, a zero box side — and takes part in
 * nothing.
 */
function toWorld(shape: Shape3, transform: Transform): WorldShape | null {
  const world = worldGeometry(shape, transform);
  switch (world.kind) {
    case "sphere":
      return world.radius > 0 ? world : null;
    case "box":
      return world.half.x > 0 && world.half.y > 0 && world.half.z > 0
        ? world
        : null;
    case "capsule":
      return world.radius > 0 ? world : null;
  }
}

/** The axis-aligned bounds of a world shape, for the broad phase and `bounds()`. */
function worldBounds(shape: WorldShape): Box3 {
  switch (shape.kind) {
    case "sphere":
      return {
        min: {
          x: shape.center.x - shape.radius,
          y: shape.center.y - shape.radius,
          z: shape.center.z - shape.radius,
        },
        max: {
          x: shape.center.x + shape.radius,
          y: shape.center.y + shape.radius,
          z: shape.center.z + shape.radius,
        },
      };
    case "box": {
      // The oriented box's world extent per axis is the sum of each local
      // axis's projection — |R| times the half extents, the standard trick.
      const ex =
        Math.abs(shape.axes[0].x) * shape.half.x +
        Math.abs(shape.axes[1].x) * shape.half.y +
        Math.abs(shape.axes[2].x) * shape.half.z;
      const ey =
        Math.abs(shape.axes[0].y) * shape.half.x +
        Math.abs(shape.axes[1].y) * shape.half.y +
        Math.abs(shape.axes[2].y) * shape.half.z;
      const ez =
        Math.abs(shape.axes[0].z) * shape.half.x +
        Math.abs(shape.axes[1].z) * shape.half.y +
        Math.abs(shape.axes[2].z) * shape.half.z;
      return {
        min: {
          x: shape.center.x - ex,
          y: shape.center.y - ey,
          z: shape.center.z - ez,
        },
        max: {
          x: shape.center.x + ex,
          y: shape.center.y + ey,
          z: shape.center.z + ez,
        },
      };
    }
    case "capsule":
      return {
        min: {
          x: Math.min(shape.p0.x, shape.p1.x) - shape.radius,
          y: Math.min(shape.p0.y, shape.p1.y) - shape.radius,
          z: Math.min(shape.p0.z, shape.p1.z) - shape.radius,
        },
        max: {
          x: Math.max(shape.p0.x, shape.p1.x) + shape.radius,
          y: Math.max(shape.p0.y, shape.p1.y) + shape.radius,
          z: Math.max(shape.p0.z, shape.p1.z) + shape.radius,
        },
      };
  }
}

/**
 * Whether two bounds overlap with positive volume. Strict, to match the
 * strict narrow phase: shapes that merely share a face cannot penetrate.
 */
function boundsOverlap(a: Box3, b: Box3): boolean {
  return (
    a.min.x < b.max.x &&
    b.min.x < a.max.x &&
    a.min.y < b.max.y &&
    b.min.y < a.max.y &&
    a.min.z < b.max.z &&
    b.min.z < a.max.z
  );
}

/* -------------------------------------------------------------------------- */
/* Segment helpers                                                            */
/* -------------------------------------------------------------------------- */

/** The closest point to `target` on the segment from `p` to `q`. */
function closestOnSegment(p: Vec3, q: Vec3, target: Vec3): Vec3 {
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const ez = q.z - p.z;
  const length2 = ex * ex + ey * ey + ez * ez;
  if (length2 === 0) return { x: p.x, y: p.y, z: p.z };
  const t = Math.max(
    0,
    Math.min(
      1,
      ((target.x - p.x) * ex + (target.y - p.y) * ey + (target.z - p.z) * ez) /
        length2,
    ),
  );
  return { x: p.x + ex * t, y: p.y + ey * t, z: p.z + ez * t };
}

/**
 * The closest pair of points between the segments `p1q1` and `p2q2` — the
 * standard clamped-parameter derivation, with the parallel case resolved
 * deterministically toward the first segment's start.
 */
function closestSegmentSegment(
  p1: Vec3,
  q1: Vec3,
  p2: Vec3,
  q2: Vec3,
): { a: Vec3; b: Vec3 } {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z;
  const e = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z;
  const f = d2.x * r.x + d2.y * r.y + d2.z * r.z;

  let s: number;
  let t: number;
  if (a === 0 && e === 0) {
    s = 0;
    t = 0;
  } else if (a === 0) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1.x * r.x + d1.y * r.y + d1.z * r.z;
    if (e === 0) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z;
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  return {
    a: { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s },
    b: { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t },
  };
}

/* -------------------------------------------------------------------------- */
/* Manifolds                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Two spheres — or two sphere-like closest points, which is how the capsule
 * pairs reduce — with the normal from `a` toward `b`. A pair with no direction
 * of its own (coincident centers) takes the fixed `(1, 0, 0)` normal, so the
 * report is deterministic. The point is the midpoint of the lens the two
 * boundaries cut off along the axis.
 */
function sphereSphere(
  aCenter: Vec3,
  aRadius: number,
  bCenter: Vec3,
  bRadius: number,
): Manifold | null {
  const dx = bCenter.x - aCenter.x;
  const dy = bCenter.y - aCenter.y;
  const dz = bCenter.z - aCenter.z;
  const sum = aRadius + bRadius;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= sum * sum) return null;
  const d = Math.sqrt(d2);
  const normal =
    d > 0 ? { x: dx / d, y: dy / d, z: dz / d } : { x: 1, y: 0, z: 0 };
  const depth = sum - d;
  const along = aRadius - depth / 2;
  return {
    normal,
    depth,
    point: {
      x: aCenter.x + normal.x * along,
      y: aCenter.y + normal.y * along,
      z: aCenter.z + normal.z * along,
    },
  };
}

/** `point` expressed in `box`'s local frame, one coordinate per axis. */
function boxLocal(box: WorldBox, point: Vec3): Vec3 {
  const dx = point.x - box.center.x;
  const dy = point.y - box.center.y;
  const dz = point.z - box.center.z;
  return {
    x: dx * box.axes[0].x + dy * box.axes[0].y + dz * box.axes[0].z,
    y: dx * box.axes[1].x + dy * box.axes[1].y + dz * box.axes[1].z,
    z: dx * box.axes[2].x + dy * box.axes[2].y + dz * box.axes[2].z,
  };
}

/** Local box coordinates carried back into world space. */
function boxWorld(box: WorldBox, local: Vec3): Vec3 {
  return {
    x:
      box.center.x +
      box.axes[0].x * local.x +
      box.axes[1].x * local.y +
      box.axes[2].x * local.z,
    y:
      box.center.y +
      box.axes[0].y * local.x +
      box.axes[1].y * local.y +
      box.axes[2].y * local.z,
    z:
      box.center.z +
      box.axes[0].z * local.x +
      box.axes[1].z * local.y +
      box.axes[2].z * local.z,
  };
}

/** The half extent of `box` along axis index `i`. */
function halfOf(box: WorldBox, i: 0 | 1 | 2): number {
  return i === 0 ? box.half.x : i === 1 ? box.half.y : box.half.z;
}

/** One coordinate of a local vector by axis index. */
function localOf(local: Vec3, i: 0 | 1 | 2): number {
  return i === 0 ? local.x : i === 1 ? local.y : local.z;
}

/**
 * The face rule a center inside the box separates through: the axis with the
 * least clearance, signed toward the side the point sits on (a point dead on
 * the center plane leaves through +axis, deterministically). Returns the
 * axis index, the sign, and the clearance.
 */
function nearestFace(
  box: WorldBox,
  local: Vec3,
): { axis: 0 | 1 | 2; sign: 1 | -1; clearance: number } {
  let axis: 0 | 1 | 2 = 0;
  let clearance = Infinity;
  for (const i of [0, 1, 2] as const) {
    const c = halfOf(box, i) - Math.abs(localOf(local, i));
    if (c < clearance) {
      clearance = c;
      axis = i;
    }
  }
  return { axis, sign: localOf(local, axis) >= 0 ? 1 : -1, clearance };
}

/**
 * Sphere against oriented box by closest point, normal from the sphere toward
 * the box.
 *
 * Two regimes: a center outside the box separates along the line to the
 * closest boundary point; a center inside separates through the face with the
 * least clearance, which is the direction that pushes the sphere out the
 * shortest way.
 */
function sphereBox(sphere: WorldSphere, box: WorldBox): Manifold | null {
  const local = boxLocal(box, sphere.center);
  const clamped = {
    x: Math.max(-box.half.x, Math.min(box.half.x, local.x)),
    y: Math.max(-box.half.y, Math.min(box.half.y, local.y)),
    z: Math.max(-box.half.z, Math.min(box.half.z, local.z)),
  };
  const inside =
    Math.abs(local.x) <= box.half.x &&
    Math.abs(local.y) <= box.half.y &&
    Math.abs(local.z) <= box.half.z;

  if (!inside) {
    const closest = boxWorld(box, clamped);
    const dx = closest.x - sphere.center.x;
    const dy = closest.y - sphere.center.y;
    const dz = closest.z - sphere.center.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= sphere.radius) return null;
    // Outside means some coordinate exceeded its half extent, so d > 0 and
    // the line to the closest point is a real direction.
    return {
      normal: { x: dx / d, y: dy / d, z: dz / d },
      depth: sphere.radius - d,
      point: closest,
    };
  }

  const face = nearestFace(box, local);
  const axis = box.axes[face.axis];
  // The sphere leaves through the nearest face along the face's outward
  // normal, so the sphere-toward-box direction is that normal negated; the
  // depth is the radius plus how far the center already sits inside.
  const n = {
    x: axis.x * face.sign,
    y: axis.y * face.sign,
    z: axis.z * face.sign,
  };
  return {
    normal: { x: -n.x, y: -n.y, z: -n.z },
    depth: sphere.radius + face.clearance,
    point: {
      x: sphere.center.x + n.x * face.clearance,
      y: sphere.center.y + n.y * face.clearance,
      z: sphere.center.z + n.z * face.clearance,
    },
  };
}

/** The projection radius of `box` onto the unit axis `u`. */
function boxRadiusOn(box: WorldBox, u: Vec3): number {
  return (
    box.half.x *
      Math.abs(
        u.x * box.axes[0].x + u.y * box.axes[0].y + u.z * box.axes[0].z,
      ) +
    box.half.y *
      Math.abs(
        u.x * box.axes[1].x + u.y * box.axes[1].y + u.z * box.axes[1].z,
      ) +
    box.half.z *
      Math.abs(u.x * box.axes[2].x + u.y * box.axes[2].y + u.z * box.axes[2].z)
  );
}

/** The deepest corner of `box` along the unit direction `n` (ties toward +axis). */
function boxSupport(box: WorldBox, n: Vec3): Vec3 {
  let x = box.center.x;
  let y = box.center.y;
  let z = box.center.z;
  for (const i of [0, 1, 2] as const) {
    const axis = box.axes[i];
    const s =
      axis.x * n.x + axis.y * n.y + axis.z * n.z >= 0
        ? halfOf(box, i)
        : -halfOf(box, i);
    x += axis.x * s;
    y += axis.y * s;
    z += axis.z * s;
  }
  return { x, y, z };
}

/**
 * Oriented box against oriented box by separating axes — the two boxes' six
 * face normals and the nine pairwise edge cross products, the fifteen axes
 * that decide OBB overlap exactly. The manifold's normal is the axis of least
 * overlap (face axes first, so a tie prefers a face), oriented by the center
 * difference; its point is the midpoint between the deepest corner of each box
 * along that axis — a point inside the contact region.
 */
function boxBox(a: WorldBox, b: WorldBox): Manifold | null {
  const axes: Vec3[] = [...a.axes, ...b.axes];
  for (const ai of a.axes) {
    for (const bi of b.axes) {
      const cx = ai.y * bi.z - ai.z * bi.y;
      const cy = ai.z * bi.x - ai.x * bi.z;
      const cz = ai.x * bi.y - ai.y * bi.x;
      const len2 = cx * cx + cy * cy + cz * cz;
      // A near-parallel edge pair's cross is direction noise; the face axes
      // already cover that separation.
      if (len2 < 1e-12) continue;
      const len = Math.sqrt(len2);
      axes.push({ x: cx / len, y: cy / len, z: cz / len });
    }
  }

  const dx = b.center.x - a.center.x;
  const dy = b.center.y - a.center.y;
  const dz = b.center.z - a.center.z;

  let depth = Infinity;
  let axis: Vec3 | null = null;
  for (const candidate of axes) {
    const dist = Math.abs(
      dx * candidate.x + dy * candidate.y + dz * candidate.z,
    );
    const overlap =
      boxRadiusOn(a, candidate) + boxRadiusOn(b, candidate) - dist;
    if (overlap <= 0) return null;
    if (overlap < depth) {
      depth = overlap;
      axis = candidate;
    }
  }
  if (axis === null) return null;

  let nx = axis.x;
  let ny = axis.y;
  let nz = axis.z;
  if (nx * dx + ny * dy + nz * dz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const n = { x: nx, y: ny, z: nz };
  const supportA = boxSupport(a, n);
  const supportB = boxSupport(b, { x: -nx, y: -ny, z: -nz });
  return {
    normal: n,
    depth,
    point: {
      x: (supportA.x + supportB.x) / 2,
      y: (supportA.y + supportB.y) / 2,
      z: (supportA.z + supportB.z) / 2,
    },
  };
}

/**
 * Sphere against capsule: the capsule collides as the sphere of its radius
 * around the segment point closest to the sphere's center.
 */
function sphereCapsule(
  sphere: WorldSphere,
  capsule: WorldCapsule,
): Manifold | null {
  const on = closestOnSegment(capsule.p0, capsule.p1, sphere.center);
  return sphereSphere(sphere.center, sphere.radius, on, capsule.radius);
}

/**
 * Capsule against capsule: the two collide as spheres of their radii around
 * the closest pair of points between their axis segments.
 */
function capsuleCapsule(a: WorldCapsule, b: WorldCapsule): Manifold | null {
  const pair = closestSegmentSegment(a.p0, a.p1, b.p0, b.p1);
  return sphereSphere(pair.a, a.radius, pair.b, b.radius);
}

/**
 * The parameter along the capsule's local segment (`la` toward `lb`, both in
 * the box's frame) minimizing the squared distance to the box — the squared
 * distance is convex and once-differentiable in the parameter, so bisecting
 * its derivative's sign change finds the minimum, and a flat stretch (the
 * derivative identically zero) resolves toward the segment's start.
 */
function closestSegmentParameter(box: WorldBox, la: Vec3, lb: Vec3): number {
  const slope = (t: number): number => {
    let g = 0;
    for (const i of [0, 1, 2] as const) {
      const l = localOf(la, i) + (localOf(lb, i) - localOf(la, i)) * t;
      const u = localOf(lb, i) - localOf(la, i);
      const excess = Math.abs(l) - halfOf(box, i);
      if (excess > 0) g += 2 * excess * (l >= 0 ? 1 : -1) * u;
    }
    return g;
  };
  if (slope(0) >= 0) return 0;
  if (slope(1) <= 0) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 64; i += 1) {
    const mid = (lo + hi) / 2;
    const g = slope(mid);
    if (g === 0) return mid;
    if (g < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The parameter along the capsule's local segment deepest inside the box —
 * the clearance profile is a minimum of concave pieces and so concave, and a
 * fixed-count ternary search finds its maximum deterministically, resolving a
 * flat profile toward the segment's start.
 */
function deepestSegmentParameter(box: WorldBox, la: Vec3, lb: Vec3): number {
  const clearance = (t: number): number => {
    let c = Infinity;
    for (const i of [0, 1, 2] as const) {
      const l = localOf(la, i) + (localOf(lb, i) - localOf(la, i)) * t;
      c = Math.min(c, halfOf(box, i) - Math.abs(l));
    }
    return c;
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 96; i += 1) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (clearance(m1) < clearance(m2)) lo = m1;
    else hi = m2;
  }
  return (lo + hi) / 2;
}

/**
 * Oriented box against capsule, normal from the box toward the capsule. The
 * capsule is its axis segment swept by its radius, so the pair penetrates when
 * the segment comes within the radius of the box: a segment still outside
 * separates along the line from the box's closest boundary point, and a
 * segment reaching the interior separates through the face nearest its
 * deepest point, the swept analogue of the sphere-inside rule.
 */
function boxCapsule(box: WorldBox, capsule: WorldCapsule): Manifold | null {
  const la = boxLocal(box, capsule.p0);
  const lb = boxLocal(box, capsule.p1);
  const t = closestSegmentParameter(box, la, lb);
  const local = {
    x: la.x + (lb.x - la.x) * t,
    y: la.y + (lb.y - la.y) * t,
    z: la.z + (lb.z - la.z) * t,
  };
  const clamped = {
    x: Math.max(-box.half.x, Math.min(box.half.x, local.x)),
    y: Math.max(-box.half.y, Math.min(box.half.y, local.y)),
    z: Math.max(-box.half.z, Math.min(box.half.z, local.z)),
  };
  const ddx = local.x - clamped.x;
  const ddy = local.y - clamped.y;
  const ddz = local.z - clamped.z;
  const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
  if (dist >= capsule.radius) return null;

  if (dist > DEEP_EPSILON) {
    const closest = boxWorld(box, clamped);
    const on = boxWorld(box, local);
    const d = dist;
    return {
      normal: {
        x: (on.x - closest.x) / d,
        y: (on.y - closest.y) / d,
        z: (on.z - closest.z) / d,
      },
      depth: capsule.radius - d,
      point: closest,
    };
  }

  // The segment reaches the interior: the face nearest its deepest point is
  // the shortest way out for the whole sweep.
  const deepT = deepestSegmentParameter(box, la, lb);
  const deepLocal = {
    x: la.x + (lb.x - la.x) * deepT,
    y: la.y + (lb.y - la.y) * deepT,
    z: la.z + (lb.z - la.z) * deepT,
  };
  const face = nearestFace(box, deepLocal);
  const axis = box.axes[face.axis];
  const n = {
    x: axis.x * face.sign,
    y: axis.y * face.sign,
    z: axis.z * face.sign,
  };
  const deepWorld = boxWorld(box, deepLocal);
  return {
    normal: n,
    depth: capsule.radius + face.clearance,
    point: {
      x: deepWorld.x + n.x * face.clearance,
      y: deepWorld.y + n.y * face.clearance,
      z: deepWorld.z + n.z * face.clearance,
    },
  };
}

/** `m` with its normal reversed — the manifold of the pair read the other way. */
function flip(m: Manifold | null): Manifold | null {
  if (m === null) return null;
  return {
    normal: { x: -m.normal.x, y: -m.normal.y, z: -m.normal.z },
    depth: m.depth,
    point: m.point,
  };
}

/**
 * The manifold separating two world shapes, oriented from `a` toward `b`, or
 * `null` when they do not penetrate. The six pair kinds each have their own
 * derivation above; the mixed pairs computed the other way around are flipped
 * here so every caller reads one orientation rule.
 */
function manifoldOf(a: WorldShape, b: WorldShape): Manifold | null {
  if (a.kind === "sphere") {
    if (b.kind === "sphere") {
      return sphereSphere(a.center, a.radius, b.center, b.radius);
    }
    if (b.kind === "box") return sphereBox(a, b);
    return sphereCapsule(a, b);
  }
  if (a.kind === "box") {
    if (b.kind === "sphere") return flip(sphereBox(b, a));
    if (b.kind === "box") return boxBox(a, b);
    return boxCapsule(a, b);
  }
  if (b.kind === "sphere") return flip(sphereCapsule(b, a));
  if (b.kind === "box") return flip(boxCapsule(b, a));
  return capsuleCapsule(a, b);
}

/* -------------------------------------------------------------------------- */
/* Rays                                                                       */
/* -------------------------------------------------------------------------- */

/** Where a ray meets one shape: the parameter along the ray and the normal. */
interface RayHit {
  t: number;
  point: Vec3;
  normal: Vec3;
}

/**
 * A hit at the origin, for a ray that starts inside a shape. There is no
 * surface under the origin to take a normal from, so the normal faces back
 * along the ray — the direction that leaves the shape the way the ray came in.
 */
function insideHit(origin: Vec3, direction: Vec3): RayHit {
  // `|| 0` turns the `-0` a negated zero component produces back into `0`, so
  // the reported normal serializes and compares as the plain value it means.
  return {
    t: 0,
    point: { x: origin.x, y: origin.y, z: origin.z },
    normal: {
      x: -direction.x || 0,
      y: -direction.y || 0,
      z: -direction.z || 0,
    },
  };
}

/** Where the ray first meets the sphere within `maxDistance`, or `null`. */
function raySphereAt(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  center: Vec3,
  radius: number,
): RayHit | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c < 0) return insideHit(origin, direction);
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxDistance) return null;
  const point = {
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
    z: origin.z + direction.z * t,
  };
  return {
    t,
    point,
    normal: {
      x: (point.x - center.x) / radius,
      y: (point.y - center.y) / radius,
      z: (point.z - center.z) / radius,
    },
  };
}

/**
 * Where the ray first meets the oriented box within `maxDistance`, or `null`
 * — the slab method in the box's own frame, with the entering slab's outward
 * face normal as the surface normal at the hit.
 */
function rayBox(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  box: WorldBox,
): RayHit | null {
  const o = boxLocal(box, origin);
  const d = {
    x:
      direction.x * box.axes[0].x +
      direction.y * box.axes[0].y +
      direction.z * box.axes[0].z,
    y:
      direction.x * box.axes[1].x +
      direction.y * box.axes[1].y +
      direction.z * box.axes[1].z,
    z:
      direction.x * box.axes[2].x +
      direction.y * box.axes[2].y +
      direction.z * box.axes[2].z,
  };

  let tEnter = -Infinity;
  let tExit = Infinity;
  let enterAxis: 0 | 1 | 2 = 0;
  let enterSign = 1;
  for (const i of [0, 1, 2] as const) {
    const oi = localOf(o, i);
    const di = localOf(d, i);
    const h = halfOf(box, i);
    if (di === 0) {
      // Parallel to the slab: outside it means outside forever.
      if (Math.abs(oi) > h) return null;
      continue;
    }
    const t1 = (-h - oi) / di;
    const t2 = (h - oi) / di;
    const near = Math.min(t1, t2);
    const far = Math.max(t1, t2);
    if (near > tEnter) {
      tEnter = near;
      enterAxis = i;
      // Entering through the face the ray runs against: -half when moving
      // +axis, +half when moving -axis.
      enterSign = di > 0 ? -1 : 1;
    }
    if (far < tExit) tExit = far;
  }
  if (tEnter > tExit || tExit < 0) return null;
  if (tEnter < 0) return insideHit(origin, direction);
  if (tEnter > maxDistance) return null;
  const axis = box.axes[enterAxis];
  return {
    t: tEnter,
    point: {
      x: origin.x + direction.x * tEnter,
      y: origin.y + direction.y * tEnter,
      z: origin.z + direction.z * tEnter,
    },
    normal: {
      x: axis.x * enterSign,
      y: axis.y * enterSign,
      z: axis.z * enterSign,
    },
  };
}

/**
 * Where the ray first meets the capsule within `maxDistance`, or `null` — the
 * earliest of the cylindrical side (a quadratic against the axis, valid while
 * the hit projects onto the segment) and the two cap spheres. An origin
 * already inside the capsule is an inside hit, and an origin outside is
 * outside both cap spheres, so the sphere helper's inside branch cannot fire
 * from here.
 */
function rayCapsule(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  capsule: WorldCapsule,
): RayHit | null {
  const on = closestOnSegment(capsule.p0, capsule.p1, origin);
  const ix = origin.x - on.x;
  const iy = origin.y - on.y;
  const iz = origin.z - on.z;
  if (ix * ix + iy * iy + iz * iz < capsule.radius * capsule.radius) {
    return insideHit(origin, direction);
  }

  const axl = {
    x: capsule.p1.x - capsule.p0.x,
    y: capsule.p1.y - capsule.p0.y,
    z: capsule.p1.z - capsule.p0.z,
  };
  const height = Math.sqrt(axl.x * axl.x + axl.y * axl.y + axl.z * axl.z);

  let best: RayHit | null = null;
  const consider = (hit: RayHit | null): void => {
    if (hit !== null && (best === null || hit.t < best.t)) best = hit;
  };

  if (height > 0) {
    const ax = { x: axl.x / height, y: axl.y / height, z: axl.z / height };
    const m = {
      x: origin.x - capsule.p0.x,
      y: origin.y - capsule.p0.y,
      z: origin.z - capsule.p0.z,
    };
    const md = m.x * ax.x + m.y * ax.y + m.z * ax.z;
    const nd = direction.x * ax.x + direction.y * ax.y + direction.z * ax.z;
    const mp = { x: m.x - ax.x * md, y: m.y - ax.y * md, z: m.z - ax.z * md };
    const np = {
      x: direction.x - ax.x * nd,
      y: direction.y - ax.y * nd,
      z: direction.z - ax.z * nd,
    };
    const a = np.x * np.x + np.y * np.y + np.z * np.z;
    if (a > 0) {
      const b = mp.x * np.x + mp.y * np.y + mp.z * np.z;
      const c =
        mp.x * mp.x +
        mp.y * mp.y +
        mp.z * mp.z -
        capsule.radius * capsule.radius;
      const disc = b * b - a * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / a;
        if (t >= 0 && t <= maxDistance) {
          const s = md + t * nd;
          if (s >= 0 && s <= height) {
            const point = {
              x: origin.x + direction.x * t,
              y: origin.y + direction.y * t,
              z: origin.z + direction.z * t,
            };
            const axisPoint = {
              x: capsule.p0.x + ax.x * s,
              y: capsule.p0.y + ax.y * s,
              z: capsule.p0.z + ax.z * s,
            };
            consider({
              t,
              point,
              normal: {
                x: (point.x - axisPoint.x) / capsule.radius,
                y: (point.y - axisPoint.y) / capsule.radius,
                z: (point.z - axisPoint.z) / capsule.radius,
              },
            });
          }
        }
      }
    }
  }

  consider(
    raySphereAt(origin, direction, maxDistance, capsule.p0, capsule.radius),
  );
  consider(
    raySphereAt(origin, direction, maxDistance, capsule.p1, capsule.radius),
  );
  return best;
}

/** Where the ray first meets `shape` within `maxDistance`, or `null`. */
function rayShape(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  shape: WorldShape,
): RayHit | null {
  switch (shape.kind) {
    case "sphere":
      return raySphereAt(
        origin,
        direction,
        maxDistance,
        shape.center,
        shape.radius,
      );
    case "box":
      return rayBox(origin, direction, maxDistance, shape);
    case "capsule":
      return rayCapsule(origin, direction, maxDistance, shape);
  }
}

/* -------------------------------------------------------------------------- */
/* The collision system                                                       */
/* -------------------------------------------------------------------------- */

/** The three events the pass emits, out of the whole map. */
type CollisionEventName = keyof CollisionEventMap;

/**
 * What the system needs from the world it serves. The world implementer wires
 * these when it constructs the system, one per world.
 */
export interface CollisionDeps {
  /**
   * Every live actor, in spawn order. Read fresh on every pass and every
   * query, so the system holds no actor list of its own.
   */
  actors(): readonly Actor[];

  /**
   * Emit one of the pass's events on the engine's broadcaster. Containment of
   * a throwing handler is the broadcaster's own contract, not re-implemented
   * here.
   */
  emit<K extends CollisionEventName>(
    event: K,
    payload: CollisionEventMap[K],
  ): void;
}

/** One collider taking part, with the actor that owns it. */
interface Entry {
  actor: Actor;
  collider: ColliderComponent;
}

/** An overlapping pair the pass is holding, as it was reported. */
interface ActivePair {
  a: Actor;
  b: Actor;
  colliders: [ColliderComponent, ColliderComponent];
}

/**
 * The engine's implementation of the {@link CollisionWorld} interface, and
 * the home of the frame's collision pass.
 *
 * Internal: the engine alone constructs it, one per world, and the world's
 * frame driver calls {@link pass} once per unpaused frame — after ticks and
 * timers, before the game mode — and {@link close} when the world closes. The
 * public query surface below is the contract and is not to be reshaped.
 *
 * The only state the system holds is the set of overlapping pairs it has
 * begun and not yet ended, which is exactly the memory the `overlap:end` edge
 * requires. Everything else — every pass and every query — is answered from
 * the colliders as they stand at the moment of the call.
 */
export class CollisionSystem implements CollisionWorld {
  private readonly deps: CollisionDeps;

  /**
   * The overlapping pairs begun and not yet ended, keyed order-independently
   * per collider pair, each holding the payload it was begun with so its end
   * reports the same actors and colliders even after one of them has left the
   * world.
   */
  private active = new Map<string, ActivePair>();

  /**
   * Identity keys for colliders, handed out lazily. A pair's key joins the
   * two colliders' keys smallest-first, so the key is the same whichever
   * order enumeration happens to visit them in.
   */
  private readonly keys = new WeakMap<ColliderComponent, number>();
  private nextKey = 1;

  constructor(deps: CollisionDeps) {
    this.deps = deps;
  }

  /**
   * The frame's pass: test every pair the responses do not ignore, emit `hit`
   * for each blocking pair found, `overlap:begin` for each overlapping pair
   * not already held, and `overlap:end` for each held pair no longer found —
   * which covers separation, a collider disabled or reshaped, and an actor
   * destroyed, since a destroyed actor's colliders are simply no longer
   * enumerated.
   *
   * Every reported pair puts the actor with the lower `id` first — checked
   * against the ids rather than assumed from enumeration order, so the rule
   * holds however the actor list arrives — and orients the manifold from
   * `colliders[0]` toward `colliders[1]`. Events for found pairs are emitted
   * in enumeration order and the frame's ends after them, in the order the
   * pairs were begun, so a frame's report is deterministic. The colliders are
   * snapshotted once at the top of the pass: a handler that destroys an actor
   * mid-pass changes next frame's pass, not this one's.
   */
  pass(): void {
    const entries = this.collect();
    const shapes: (WorldShape | null)[] = [];
    const boxes: (Box3 | null)[] = [];
    for (const entry of entries) {
      const shape = toWorld(
        entry.collider.shape,
        entry.collider.worldTransform(),
      );
      shapes.push(shape);
      boxes.push(shape === null ? null : worldBounds(shape));
    }

    const found = new Map<string, ActivePair>();
    for (let i = 0; i < entries.length; i += 1) {
      const first = entries[i]!;
      const firstShape = shapes[i];
      const firstBox = boxes[i];
      if (firstShape === null || firstShape === undefined) continue;
      for (let j = i + 1; j < entries.length; j += 1) {
        const second = entries[j]!;
        // An actor's own colliders are one body, not a pair.
        if (second.actor === first.actor) continue;
        const response = resolve(
          first.collider.channel,
          first.collider.responses,
          second.collider.channel,
          second.collider.responses,
        );
        if (response === "ignore") continue;
        const secondShape = shapes[j];
        const secondBox = boxes[j];
        if (secondShape === null || secondShape === undefined) continue;
        if (!boundsOverlap(firstBox!, secondBox!)) continue;

        // The lower-id rule, made structural: order the pair by actor id
        // before the manifold is taken, so the normal is computed in the
        // orientation it is reported in.
        const swap = first.actor.id > second.actor.id;
        const [ea, eb] = swap ? [second, first] : [first, second];
        const [sa, sb] = swap
          ? [secondShape, firstShape]
          : [firstShape, secondShape];
        const manifold = manifoldOf(sa, sb);
        if (manifold === null) continue;

        const payload: ActivePair = {
          a: ea.actor,
          b: eb.actor,
          colliders: [ea.collider, eb.collider],
        };
        if (response === "block") {
          this.deps.emit("hit", { ...payload, manifold });
        } else {
          const key = this.pairKey(ea.collider, eb.collider);
          found.set(key, payload);
          if (!this.active.has(key)) this.deps.emit("overlap:begin", payload);
        }
      }
    }

    for (const [key, pair] of this.active) {
      if (!found.has(key)) this.deps.emit("overlap:end", pair);
    }
    this.active = found;
  }

  /**
   * The world is closing: every held overlapping pair ends now, in the order
   * the pairs were begun, because no further pass will run to end them.
   */
  close(): void {
    const held = this.active;
    this.active = new Map();
    for (const pair of held.values()) this.deps.emit("overlap:end", pair);
  }

  /**
   * The colliders currently intersecting one of `actor`'s, each with the
   * actor that owns it.
   *
   * Filtered by the same both-directions rule the pass applies — a pair the
   * responses resolve to `ignore` is never tested, so it does not appear here
   * either — and answered from the colliders as they stand now, independent
   * of what the last pass reported. A collider intersecting two of the
   * actor's colliders appears once.
   */
  overlaps(actor: Actor): readonly Overlap[] {
    if (!actor.alive) return [];
    const mine: {
      collider: ColliderComponent;
      shape: WorldShape;
      box: Box3;
    }[] = [];
    for (const component of actor.components) {
      if (!(component instanceof ColliderComponent) || !component.enabled)
        continue;
      const shape = toWorld(component.shape, component.worldTransform());
      if (shape === null) continue;
      mine.push({ collider: component, shape, box: worldBounds(shape) });
    }
    if (mine.length === 0) return [];

    const out: Overlap[] = [];
    const seen = new Set<ColliderComponent>();
    for (const entry of this.collect()) {
      if (entry.actor === actor || seen.has(entry.collider)) continue;
      let other: WorldShape | null | undefined;
      let otherBox: Box3 | undefined;
      for (const own of mine) {
        const response = resolve(
          own.collider.channel,
          own.collider.responses,
          entry.collider.channel,
          entry.collider.responses,
        );
        if (response === "ignore") continue;
        if (other === undefined) {
          other = toWorld(
            entry.collider.shape,
            entry.collider.worldTransform(),
          );
          if (other !== null) otherBox = worldBounds(other);
        }
        if (other === null) break;
        if (!boundsOverlap(own.box, otherBox!)) continue;
        if (manifoldOf(own.shape, other) !== null) {
          seen.add(entry.collider);
          out.push({ actor: entry.actor, collider: entry.collider });
          break;
        }
      }
    }
    return out;
  }

  /**
   * The colliders `shape` intersects when it is placed at `at` — with
   * identity orientation and unit scale, the documented placement; an
   * oriented test is run by giving an actor a collider.
   */
  query(shape: Shape3, at: Vec3, options?: QueryOptions): readonly Overlap[] {
    const placed = toWorld(shape, {
      position: { x: at.x, y: at.y, z: at.z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    if (placed === null) return [];
    const box = worldBounds(placed);
    const out: Overlap[] = [];
    this.candidates(options, (entry, entryShape, entryBox) => {
      if (!boundsOverlap(box, entryBox)) return;
      if (manifoldOf(placed, entryShape) !== null) {
        out.push({ actor: entry.actor, collider: entry.collider });
      }
    });
    return out;
  }

  /**
   * The nearest hit along the ray, or `null`. `direction` is a unit vector
   * and `distance` bounds the ray's length, in world units. A tie in distance
   * goes to the collider enumerated first, so the answer is deterministic.
   */
  raycast(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    options?: QueryOptions,
  ): Hit | null {
    let best: Hit | null = null;
    this.candidates(options, (entry, entryShape) => {
      const hit = rayShape(origin, direction, distance, entryShape);
      if (hit === null) return;
      if (best === null || hit.t < best.distance) {
        best = {
          actor: entry.actor,
          collider: entry.collider,
          point: hit.point,
          normal: hit.normal,
          distance: hit.t,
        };
      }
    });
    return best;
  }

  /**
   * Every hit along the ray, in increasing `distance` — one hit per collider,
   * each at the point the ray first meets it. Equal distances keep
   * enumeration order.
   */
  raycastAll(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    options?: QueryOptions,
  ): readonly Hit[] {
    const out: Hit[] = [];
    this.candidates(options, (entry, entryShape) => {
      const hit = rayShape(origin, direction, distance, entryShape);
      if (hit === null) return;
      out.push({
        actor: entry.actor,
        collider: entry.collider,
        point: hit.point,
        normal: hit.normal,
        distance: hit.t,
      });
    });
    // Array.prototype.sort is stable, so ties keep enumeration order.
    return out.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Every collider taking part right now: enabled, on a live actor, actors in
   * the order `deps.actors()` hands them over and colliders in attachment
   * order — the enumeration order the pass's reports and the queries' results
   * are stated in. `alive` is checked here even though `actors()` promises
   * live actors, because an actor destroyed this frame is out of the pass at
   * once while it leaves the world only at the frame's end.
   */
  private collect(): Entry[] {
    const out: Entry[] = [];
    for (const actor of this.deps.actors()) {
      if (!actor.alive) continue;
      for (const component of actor.components) {
        if (component instanceof ColliderComponent && component.enabled) {
          out.push({ actor, collider: component });
        }
      }
    }
    return out;
  }

  /**
   * Walks the colliders a query with `options` is allowed to see — the
   * both-directions resolution against the query's channel and responses left
   * something stronger than `ignore`, the owning actor is not in `ignore`,
   * and the shape is not degenerate — handing each to `fn` with its world
   * shape and bounds.
   */
  private candidates(
    options: QueryOptions | undefined,
    fn: (entry: Entry, shape: WorldShape, box: Box3) => void,
  ): void {
    const channel = options?.channel ?? "default";
    const responses = options?.responses ?? {};
    const ignore = options?.ignore ?? [];
    for (const entry of this.collect()) {
      if (ignore.includes(entry.actor)) continue;
      const response = resolve(
        channel,
        responses,
        entry.collider.channel,
        entry.collider.responses,
      );
      if (response === "ignore") continue;
      const shape = toWorld(
        entry.collider.shape,
        entry.collider.worldTransform(),
      );
      if (shape === null) continue;
      fn(entry, shape, worldBounds(shape));
    }
  }

  /** The order-independent identity key for a pair of colliders. */
  private pairKey(a: ColliderComponent, b: ColliderComponent): string {
    const ka = this.keyOf(a);
    const kb = this.keyOf(b);
    return ka < kb ? `${ka}:${kb}` : `${kb}:${ka}`;
  }

  /** The identity key for one collider, assigned on first sight. */
  private keyOf(collider: ColliderComponent): number {
    let key = this.keys.get(collider);
    if (key === undefined) {
      key = this.nextKey;
      this.nextKey += 1;
      this.keys.set(collider, key);
    }
    return key;
  }
}
