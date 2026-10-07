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
 * never tested. A reported pair puts the actor with the lower `id` first, and
 * `manifold.normal` points from `colliders[0]` toward `colliders[1]`.
 *
 * The geometry model, stated once because every test below leans on it:
 *
 * - A shape is carried into world space by the component's `worldTransform()`
 *   — the actor's transform composed with the component's `offset` — so a
 *   collider follows its actor the way a drawn component does. A box becomes a
 *   world-space oriented box: a center, three orthonormal axes taken from the
 *   rotation, and a half-extent per axis. A capsule becomes the segment its
 *   cylindrical core spans, along the transform's local `+Y`, with a radius. A
 *   sphere becomes a center and a radius and keeps none of the rotation, which
 *   is what "a sphere ignores it" means arithmetically.
 * - Scale reaches the shape the way the docs state it: a box's extents scale
 *   per axis, a capsule's `height` scales by the Y factor, and a sphere's or a
 *   capsule's radius scales by the largest of the three factors. A rounded
 *   shape under a non-uniform scale would be an ellipsoid, which the pair tests
 *   have no closed form for, so the enclosing round shape stands in — the same
 *   trade the two-dimensional engine makes for a circle.
 * - Two shapes collide when they *penetrate*: a pair exactly touching, with
 *   zero depth, is not reported. That keeps a floor of adjacent tiles from
 *   reporting a hit per shared face every frame.
 * - A degenerate shape — a radius at or below zero, a box with a side at or
 *   below zero, any extent that is not a number — takes part in nothing: it
 *   cannot penetrate, so testing it would only manufacture ambiguous manifolds.
 *
 * The manifolds themselves follow one pattern, borrowed from the
 * two-dimensional engine and generalized: a *separated* pair is measured by the
 * closest points between the two volumes, which gives the exact normal and the
 * exact depth; a pair whose cores have interpenetrated far enough that there is
 * no line between them separates along the axis of least overlap, which is the
 * shortest way out. Concretely:
 *
 * - Sphere against sphere is the center line, always.
 * - Sphere against box is the closest point on the box while the center is
 *   outside it, and the nearest face once the center is inside.
 * - Sphere or capsule against a capsule reduces to sphere against sphere at
 *   the closest points of the segments involved, because a capsule is a
 *   segment swept by a ball.
 * - Box against box is separating axes over the fifteen candidates an oriented
 *   pair has — three faces each and the nine edge-edge cross products — which
 *   is exact for a convex pair of boxes.
 * - Capsule against box is the closest point between the capsule's core
 *   segment and the box while the segment stays outside, and separating axes
 *   over the box's faces and the segment's edge crosses once the segment has
 *   entered the box.
 *
 * A separating-axis depth taken over a finite candidate set is a valid
 * separation whatever the set — translating until the projections onto one
 * tested axis come apart pulls the whole pair apart, because two convex volumes
 * are disjoint as soon as one axis separates them — so the reported depth is
 * always enough to resolve the pair, and for a box pair it is also the least.
 */

import { Component } from "./components";
import {
  QUAT_IDENTITY,
  add,
  cross,
  dot,
  length,
  normalize,
  quatRotate,
  scale,
  sub,
} from "./math";
import type {
  Box3,
  ColliderOptions,
  ColliderShape,
  CollisionResponse,
  Manifold,
  Quat,
  Transform,
  Vec3,
} from "./contract";
import type { Actor } from "./actors";

/**
 * Gives its actor a volume the engine tests, positioned by the component's
 * world transform — the actor's transform composed with the component's
 * `offset`, so one actor carries several colliders at different offsets and
 * composes a finer silhouette than any one shape has.
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
  shape: ColliderShape;

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
   * The world-space axis-aligned box enclosing the shape at the component's
   * world transform, in world units.
   *
   * Unlike the pass, `bounds()` answers for a degenerate shape too — the
   * enclosing box of a zero-sized shape is a zero-sized box at its position,
   * which is still the honest answer to "where is this".
   */
  bounds(): Box3 {
    return worldBounds(place(this.shape, this.worldTransform()));
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

/** A sphere carried into world space; the rotation left behind. */
interface WorldSphere {
  kind: "sphere";
  center: Vec3;
  radius: number;
}

/**
 * A box carried into world space as an oriented box: the three unit axes the
 * rotation turned the local `X`, `Y`, and `Z` into, and the half-extent along
 * each of them. Keeping the axes rather than the corners is what lets the pair
 * tests work in the box's own frame, where the box is axis-aligned and every
 * clamp is a scalar one.
 */
interface WorldBox {
  kind: "box";
  center: Vec3;
  half: Vec3;
  axes: readonly [Vec3, Vec3, Vec3];
}

/**
 * A capsule carried into world space as the segment its cylindrical core spans
 * — `a` at the local `-Y` end, `b` at the local `+Y` end — and a radius. The
 * whole volume is every point within `radius` of that segment, so the capsule
 * spans `height + 2 * radius` along its axis. A zero `height` leaves `a` and
 * `b` coincident, which is a sphere, and every test below handles it as one.
 */
interface WorldCapsule {
  kind: "capsule";
  a: Vec3;
  b: Vec3;
  radius: number;
}

type WorldShape = WorldSphere | WorldBox | WorldCapsule;

/** The local axes a rotation turns into a box's world axes. */
const LOCAL_X: Vec3 = { x: 1, y: 0, z: 0 };
const LOCAL_Y: Vec3 = { x: 0, y: 1, z: 0 };
const LOCAL_Z: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * How close two surfaces have to be before the pair is treated as having
 * interpenetrated rather than merely approached. Below it the line between the
 * closest points is too short to take a direction from, so the deep branch —
 * which reads the direction off the volumes themselves — answers instead. The
 * two branches agree in the limit, so the switch is not a discontinuity in what
 * is reported, only in how it is computed.
 */
const TOUCH_EPS2 = 1e-12;

/** Below this sine of the angle between two axes, their cross is no axis. */
const PARALLEL_EPS = 1e-9;

/** Below this much of `+X` left square to an axis, `+X` is that axis. */
const ACROSS_EPS = 1e-6;

/** `value` held inside `[low, high]`. */
function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * `n` with a negative zero written back as a positive one, so a reported normal
 * serializes and compares as the plain value it means. `NaN` is left alone:
 * this is a sign fix, not a validity one.
 */
function unsigned(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * A unit direction square to `v`, or `+X` when `v` is no direction at all.
 *
 * The part of `+X` square to `v` is preferred, so a degenerate pair whose axis
 * `+X` already crosses reports the same fixed direction two concentric spheres
 * take and the answer stays the one a reader of either case would predict. An
 * axis along `+X` has no such part, and `+Y` is square to it by construction.
 */
function across(v: Vec3): Vec3 {
  const len2 = dot(v, v);
  if (len2 <= 0) return LOCAL_X;
  const squareTo = (from: Vec3): Vec3 =>
    sub(from, scale(v, dot(from, v) / len2));
  const part = squareTo(LOCAL_X);
  return normalize(length(part) > ACROSS_EPS ? part : squareTo(LOCAL_Y));
}

/** `v` negated, each component's sign of zero normalized away. */
function negated(v: Vec3): Vec3 {
  return { x: unsigned(-v.x), y: unsigned(-v.y), z: unsigned(-v.z) };
}

/**
 * Carries `shape` into world space through `transform`, degenerate or not.
 *
 * The scale rules are the documented ones: a box's extents scale per axis, a
 * capsule's `height` by the Y factor, and a radius by the largest of the three
 * factors. Magnitudes throughout, so a mirrored actor — a negative scale — has
 * the volume of the thing it is drawn as rather than an inside-out one.
 */
function place(shape: ColliderShape, transform: Transform): WorldShape {
  const { position, rotation, scale: s } = transform;
  const center = { x: position.x, y: position.y, z: position.z };
  const largest = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
  switch (shape.kind) {
    case "sphere":
      return {
        kind: "sphere",
        center,
        radius: Math.abs(shape.radius) * largest,
      };
    case "box":
      return {
        kind: "box",
        center,
        half: {
          x: (Math.abs(shape.width) * Math.abs(s.x)) / 2,
          y: (Math.abs(shape.height) * Math.abs(s.y)) / 2,
          z: (Math.abs(shape.depth) * Math.abs(s.z)) / 2,
        },
        axes: [
          quatRotate(rotation, LOCAL_X),
          quatRotate(rotation, LOCAL_Y),
          quatRotate(rotation, LOCAL_Z),
        ],
      };
    case "capsule": {
      const axis = quatRotate(rotation, LOCAL_Y);
      const halfHeight = (Math.abs(shape.height) * Math.abs(s.y)) / 2;
      return {
        kind: "capsule",
        a: add(center, scale(axis, -halfHeight)),
        b: add(center, scale(axis, halfHeight)),
        radius: Math.abs(shape.radius) * largest,
      };
    }
  }
}

/**
 * Whether a placed shape encloses no volume and so takes part in nothing. The
 * comparisons are written the way round that answers `true` for `NaN`, so an
 * extent that is not a number is a shape the pass never sees rather than one
 * whose every test returns `false` by accident.
 */
function degenerate(shape: WorldShape): boolean {
  switch (shape.kind) {
    case "sphere":
    case "capsule":
      return !(shape.radius > 0);
    case "box":
      return !(shape.half.x > 0 && shape.half.y > 0 && shape.half.z > 0);
  }
}

/**
 * Carries `shape` into world space through `transform`, or `null` when the
 * result is degenerate and takes part in nothing.
 */
function toWorld(
  shape: ColliderShape,
  transform: Transform,
): WorldShape | null {
  const placed = place(shape, transform);
  return degenerate(placed) ? null : placed;
}

/** The axis-aligned box enclosing a world shape, for the broad phase. */
function worldBounds(shape: WorldShape): Box3 {
  switch (shape.kind) {
    case "sphere": {
      const { center: c, radius: r } = shape;
      return {
        min: { x: c.x - r, y: c.y - r, z: c.z - r },
        max: { x: c.x + r, y: c.y + r, z: c.z + r },
      };
    }
    case "capsule": {
      const { a, b, radius: r } = shape;
      return {
        min: {
          x: Math.min(a.x, b.x) - r,
          y: Math.min(a.y, b.y) - r,
          z: Math.min(a.z, b.z) - r,
        },
        max: {
          x: Math.max(a.x, b.x) + r,
          y: Math.max(a.y, b.y) + r,
          z: Math.max(a.z, b.z) + r,
        },
      };
    }
    case "box": {
      // The half-extent of the enclosing box along a world axis is the sum of
      // each oriented half-extent's projection onto it.
      const [ax, ay, az] = shape.axes;
      const { half: h, center: c } = shape;
      const ex =
        Math.abs(ax.x) * h.x + Math.abs(ay.x) * h.y + Math.abs(az.x) * h.z;
      const ey =
        Math.abs(ax.y) * h.x + Math.abs(ay.y) * h.y + Math.abs(az.y) * h.z;
      const ez =
        Math.abs(ax.z) * h.x + Math.abs(ay.z) * h.y + Math.abs(az.z) * h.z;
      return {
        min: { x: c.x - ex, y: c.y - ey, z: c.z - ez },
        max: { x: c.x + ex, y: c.y + ey, z: c.z + ez },
      };
    }
  }
}

/**
 * Whether two boxes overlap with positive volume. Strict, to match the strict
 * narrow phase: shapes that merely share a face cannot penetrate.
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
/* Box frames, segments, and closest points                                   */
/* -------------------------------------------------------------------------- */

/** A box's three axes paired with the half-extent along each. */
function frameOf(box: WorldBox): readonly (readonly [Vec3, number])[] {
  return [
    [box.axes[0], box.half.x],
    [box.axes[1], box.half.y],
    [box.axes[2], box.half.z],
  ];
}

/** A world point in the box's own frame, where the box is axis-aligned. */
function toLocal(box: WorldBox, p: Vec3): Vec3 {
  const d = sub(p, box.center);
  return {
    x: dot(d, box.axes[0]),
    y: dot(d, box.axes[1]),
    z: dot(d, box.axes[2]),
  };
}

/** A point in the box's frame carried back into the world. */
function fromLocal(box: WorldBox, p: Vec3): Vec3 {
  return add(box.center, directionToWorld(box, p));
}

/**
 * A direction in the box's frame carried back into the world, unmoved. Every
 * normal a box test reports comes through here, so the sign of zero is settled
 * here too rather than at each of the call sites.
 */
function directionToWorld(box: WorldBox, d: Vec3): Vec3 {
  const [ax, ay, az] = box.axes;
  return {
    x: unsigned(ax.x * d.x + ay.x * d.y + az.x * d.z),
    y: unsigned(ax.y * d.x + ay.y * d.y + az.y * d.z),
    z: unsigned(ax.z * d.x + ay.z * d.y + az.z * d.z),
  };
}

/** A world direction expressed in the box's frame. */
function directionToLocal(box: WorldBox, d: Vec3): Vec3 {
  return {
    x: dot(d, box.axes[0]),
    y: dot(d, box.axes[1]),
    z: dot(d, box.axes[2]),
  };
}

/** `p` held inside the axis-aligned box of half-extents `half` at the origin. */
function clampToHalf(p: Vec3, half: Vec3): Vec3 {
  return {
    x: clamp(p.x, -half.x, half.x),
    y: clamp(p.y, -half.y, half.y),
    z: clamp(p.z, -half.z, half.z),
  };
}

/** How far `p` lies outside that box, squared. Zero for a point inside it. */
function outsideDistance2(p: Vec3, half: Vec3): number {
  const dx = p.x - clamp(p.x, -half.x, half.x);
  const dy = p.y - clamp(p.y, -half.y, half.y);
  const dz = p.z - clamp(p.z, -half.z, half.z);
  return dx * dx + dy * dy + dz * dz;
}

/** The point of the box's surface furthest along `dir`, in world space. */
function support(box: WorldBox, dir: Vec3): Vec3 {
  let point = box.center;
  for (const [axis, half] of frameOf(box)) {
    point = add(point, scale(axis, dot(dir, axis) >= 0 ? half : -half));
  }
  return point;
}

/** How far the box reaches from its center along the unit direction `dir`. */
function projectedRadius(box: WorldBox, dir: Vec3): number {
  let radius = 0;
  for (const [axis, half] of frameOf(box)) {
    radius += Math.abs(dot(dir, axis)) * half;
  }
  return radius;
}

/** The closest point to `p` on the segment from `a` to `b`. */
function closestOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const e = sub(b, a);
  const len2 = dot(e, e);
  if (len2 === 0) return { x: a.x, y: a.y, z: a.z };
  return add(a, scale(e, clamp(dot(sub(p, a), e) / len2, 0, 1)));
}

/**
 * The closest pair of points on two segments, `c1` on the first and `c2` on
 * the second.
 *
 * The standard clamped least-squares solution: solve for the closest points on
 * the two infinite lines, clamp the second parameter into its segment and
 * re-solve the first against it, then clamp the first as well. Parallel
 * segments make the system singular, and the fallback of pinning the first
 * parameter at its start is what keeps the answer finite and deterministic —
 * every point of a parallel pair is equally close, so any of them is the
 * answer.
 */
function closestBetweenSegments(
  p1: Vec3,
  q1: Vec3,
  p2: Vec3,
  q2: Vec3,
): { c1: Vec3; c2: Vec3 } {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);

  let s = 0;
  let t = 0;
  if (a === 0 && e === 0) {
    // Two points: the segments are their own closest points.
  } else if (a === 0) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e === 0) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  return { c1: add(p1, scale(d1, s)), c2: add(p2, scale(d2, t)) };
}

/**
 * The closest pair of points between the segment `a`–`b` and the axis-aligned
 * box of half-extents `half` centered at the origin, with the squared distance
 * between them.
 *
 * Exact, and finite: the squared distance from a point to a convex set is a
 * convex function, and composing it with the segment's affine parameterization
 * keeps it convex in `t`, so the minimum lies either at an end of the segment
 * or at the vertex of one of the quadratics the function is stitched together
 * from. Those pieces change only where the segment crosses one of the six face
 * planes, which is at most six parameters, so collecting the ends, the
 * crossings, and each piece's vertex and taking the best of them is the whole
 * search rather than an approximation of it.
 */
function closestSegmentBox(
  a: Vec3,
  b: Vec3,
  half: Vec3,
): { onSegment: Vec3; onBox: Vec3; d2: number } {
  const d = sub(b, a);
  const axes: readonly (readonly [number, number, number])[] = [
    [a.x, d.x, half.x],
    [a.y, d.y, half.y],
    [a.z, d.z, half.z],
  ];

  const breaks: number[] = [0, 1];
  for (const [start, delta, h] of axes) {
    if (delta === 0) continue;
    for (const face of [-h, h]) {
      const t = (face - start) / delta;
      if (t > 0 && t < 1) breaks.push(t);
    }
  }
  breaks.sort((x, y) => x - y);

  const candidates = [...breaks];
  for (let i = 0; i + 1 < breaks.length; i += 1) {
    const t0 = breaks[i]!;
    const t1 = breaks[i + 1]!;
    if (!(t1 > t0)) continue;
    // Between two crossings the set of clamped axes is fixed, so the squared
    // distance is one quadratic `A t² + B t + C` and its vertex is closed form.
    const mid = (t0 + t1) / 2;
    let quadratic = 0;
    let linear = 0;
    for (const [start, delta, h] of axes) {
      const value = start + delta * mid;
      const target = value > h ? h : value < -h ? -h : null;
      if (target === null) continue;
      quadratic += delta * delta;
      linear += 2 * delta * (start - target);
    }
    if (quadratic > 0) {
      const vertex = -linear / (2 * quadratic);
      if (vertex > t0 && vertex < t1) candidates.push(vertex);
    }
  }

  const measured = candidates.map((t) => ({
    t,
    d2: outsideDistance2(add(a, scale(d, t)), half),
  }));
  let bestD2 = Infinity;
  for (const { d2 } of measured) bestD2 = Math.min(bestD2, d2);

  // A convex function's minimum is attained on an interval, and a capsule lying
  // flat against a face is exactly that case — every parameter along the
  // contact is equally close. The tied candidates bracket that interval, so the
  // middle of them is the middle of the contact, which is where a report about
  // a resting body belongs rather than at whichever end was enumerated first.
  const tolerance = 1e-12 * Math.max(1, bestD2);
  let low = Infinity;
  let high = -Infinity;
  for (const { t, d2 } of measured) {
    if (d2 > bestD2 + tolerance) continue;
    low = Math.min(low, t);
    high = Math.max(high, t);
  }
  const onSegment = add(a, scale(d, (low + high) / 2));
  return {
    onSegment,
    onBox: clampToHalf(onSegment, half),
    d2: outsideDistance2(onSegment, half),
  };
}

/* -------------------------------------------------------------------------- */
/* Manifolds                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Sphere against sphere, normal from `a` toward `b`.
 *
 * `degenerate` is the direction to report when the two centers coincide, which
 * leaves the pair with no separating direction of its own. Two real spheres are
 * separated by any of them and take the fixed default, so the report stays
 * deterministic; a pair the capsule reductions below produced is not free that
 * way — its two balls stand in for shapes swept along segments, and only a
 * direction those segments do not lie along really separates them — so those
 * callers name the direction their reduction lost.
 */
function sphereSphere(
  a: WorldSphere,
  b: WorldSphere,
  degenerate: Vec3 = LOCAL_X,
): Manifold | null {
  const between = sub(b.center, a.center);
  const sum = a.radius + b.radius;
  const d2 = dot(between, between);
  if (d2 >= sum * sum) return null;
  const d = Math.sqrt(d2);
  const normal = d > 0 ? scale(between, 1 / d) : degenerate;
  const depth = sum - d;
  // The middle of the lens the two boundaries cut off along the axis.
  return {
    normal,
    depth,
    point: add(a.center, scale(normal, a.radius - depth / 2)),
  };
}

/**
 * Sphere against box, normal from the sphere toward the box.
 *
 * Two regimes, the same pair the two-dimensional engine splits a circle against
 * a polygon into: a center outside the box separates along the line to the
 * closest point of the box; a center inside separates through the nearest face,
 * which is the direction that pushes the sphere out the shortest way.
 */
function sphereBox(sphere: WorldSphere, box: WorldBox): Manifold | null {
  const local = toLocal(box, sphere.center);
  const clamped = clampToHalf(local, box.half);
  const outward = sub(local, clamped);
  const d2 = dot(outward, outward);

  if (d2 > TOUCH_EPS2) {
    const d = Math.sqrt(d2);
    if (d >= sphere.radius) return null;
    return {
      normal: directionToWorld(box, scale(outward, -1 / d)),
      depth: sphere.radius - d,
      point: fromLocal(box, clamped),
    };
  }

  // Inside: leave through the face the center sits nearest to.
  let bestPenetration = Infinity;
  let bestAxis = box.axes[0];
  let bestSign = 1;
  let bestDelta = 0;
  for (const [axis, half, value] of [
    [box.axes[0], box.half.x, local.x],
    [box.axes[1], box.half.y, local.y],
    [box.axes[2], box.half.z, local.z],
  ] as const) {
    const penetration = half - Math.abs(value);
    if (penetration < bestPenetration) {
      bestPenetration = penetration;
      bestAxis = axis;
      bestSign = value >= 0 ? 1 : -1;
      bestDelta = (value >= 0 ? half : -half) - value;
    }
  }
  return {
    // The sphere leaves along `+bestSign * bestAxis`, so the manifold's
    // first-toward-second normal is the other way.
    normal: negated(scale(bestAxis, bestSign)),
    depth: sphere.radius + bestPenetration,
    // Sliding the center onto that face plane changes only the one component.
    point: add(sphere.center, scale(bestAxis, bestDelta)),
  };
}

/**
 * Sphere against capsule, normal from the sphere toward the capsule. A capsule
 * is a segment swept by a ball, so the closest point of the segment carries a
 * ball of the capsule's radius and the pair is two spheres.
 *
 * A center sitting exactly on the segment is the case the reduction cannot
 * answer on its own: the two balls are concentric, but pushing along the
 * segment slides the sphere down the capsule's length and separates nothing.
 * Across the axis is the direction that does, and every point of the segment is
 * then `depth` from the center, so the promised translation lands the pair
 * exactly touching.
 */
function sphereCapsule(
  sphere: WorldSphere,
  capsule: WorldCapsule,
): Manifold | null {
  return sphereSphere(
    sphere,
    {
      kind: "sphere",
      center: closestOnSegment(capsule.a, capsule.b, sphere.center),
      radius: capsule.radius,
    },
    across(sub(capsule.b, capsule.a)),
  );
}

/**
 * Capsule against capsule, normal from `a` toward `b`. The same reduction: the
 * closest points of the two core segments carry the two balls.
 *
 * Two segments that meet leave the same gap in the reduction, and the direction
 * that closes it is the common perpendicular: translate one segment along a
 * direction square to both and every pair of points on them moves apart by that
 * distance in quadrature, so the closest pair ends exactly `depth` apart and no
 * other pair is nearer. Parallel axes have no common perpendicular to speak of
 * — their cross product is no direction — and any direction across the shared
 * axis does the same work.
 */
function capsuleCapsule(a: WorldCapsule, b: WorldCapsule): Manifold | null {
  const { c1, c2 } = closestBetweenSegments(a.a, a.b, b.a, b.b);
  const axisA = sub(a.b, a.a);
  const common = cross(axisA, sub(b.b, b.a));
  return sphereSphere(
    { kind: "sphere", center: c1, radius: a.radius },
    { kind: "sphere", center: c2, radius: b.radius },
    length(common) > PARALLEL_EPS ? normalize(common) : across(axisA),
  );
}

/**
 * Box against box by separating axes, normal from `a` toward `b`.
 *
 * The fifteen candidates a pair of oriented boxes has: each box's three face
 * normals, and the nine cross products of one box's edge direction with the
 * other's. That set is complete for a convex pair, so the axis of least overlap
 * among them is the true minimum translation. A cross product of two nearly
 * parallel axes is no axis at all — its length is the sine of the angle between
 * them — and is dropped, which costs nothing: a parallel pair is separated by
 * the face axes those edges belong to.
 *
 * The manifold's point is the midpoint between each box's deepest vertex along
 * the axis, a point in the middle of the contact region, which is the "point on
 * the shared boundary" a game aims a spark or a sound at.
 */
function boxBox(a: WorldBox, b: WorldBox): Manifold | null {
  const between = sub(b.center, a.center);
  const candidates: Vec3[] = [...a.axes, ...b.axes];
  for (const first of a.axes) {
    for (const second of b.axes) {
      const axis = cross(first, second);
      if (length(axis) > PARALLEL_EPS) candidates.push(normalize(axis));
    }
  }

  let depth = Infinity;
  let chosen: Vec3 | null = null;
  for (const axis of candidates) {
    const overlap =
      projectedRadius(a, axis) +
      projectedRadius(b, axis) -
      Math.abs(dot(between, axis));
    if (overlap <= 0) return null;
    if (overlap < depth) {
      depth = overlap;
      chosen = axis;
    }
  }
  if (chosen === null) return null;

  const normal = dot(chosen, between) < 0 ? negated(chosen) : chosen;
  return {
    normal,
    depth,
    point: scale(add(support(a, normal), support(b, negated(normal))), 0.5),
  };
}

/**
 * Capsule against box, normal from the capsule toward the box.
 *
 * The same two regimes as a sphere against a box, one step up: while the
 * capsule's core segment stays outside the box the closest points between the
 * segment and the box give the exact separation, and once the segment has
 * entered the box the pair separates along the axis of least overlap among the
 * box's three faces and the three crosses of the segment's direction with them
 * — the edge-edge candidates a segment has against a box.
 *
 * The projection of a capsule onto any axis is exact whatever the axis, because
 * the capsule is the segment swollen by its radius: the segment's projection
 * widened by that radius. So the deep branch measures real overlaps, and the
 * least of them is a real way out.
 */
function capsuleBox(capsule: WorldCapsule, box: WorldBox): Manifold | null {
  const a = toLocal(box, capsule.a);
  const b = toLocal(box, capsule.b);
  const { onSegment, onBox, d2 } = closestSegmentBox(a, b, box.half);

  if (d2 > TOUCH_EPS2) {
    const d = Math.sqrt(d2);
    if (d >= capsule.radius) return null;
    return {
      normal: directionToWorld(box, scale(sub(onBox, onSegment), 1 / d)),
      depth: capsule.radius - d,
      point: fromLocal(box, onBox),
    };
  }

  const axis = sub(b, a);
  const candidates: Vec3[] = [LOCAL_X, LOCAL_Y, LOCAL_Z];
  if (length(axis) > PARALLEL_EPS) {
    const direction = normalize(axis);
    for (const face of [LOCAL_X, LOCAL_Y, LOCAL_Z]) {
      const candidate = cross(direction, face);
      if (length(candidate) > PARALLEL_EPS)
        candidates.push(normalize(candidate));
    }
  }

  const middle = scale(add(a, b), 0.5);
  const halfAxis = scale(axis, 0.5);
  let depth = Infinity;
  let chosen: Vec3 | null = null;
  let chosenReach = 0;
  for (const candidate of candidates) {
    // How far each volume reaches from its own center along the axis, against
    // how far apart the two centers are — the same measurement a box pair
    // makes, with the capsule's reach being its core's plus its radius.
    const boxRadius =
      box.half.x * Math.abs(candidate.x) +
      box.half.y * Math.abs(candidate.y) +
      box.half.z * Math.abs(candidate.z);
    const capsuleRadius = Math.abs(dot(halfAxis, candidate)) + capsule.radius;
    const overlap =
      boxRadius + capsuleRadius - Math.abs(dot(middle, candidate));
    if (overlap <= 0) return null;
    if (overlap < depth) {
      depth = overlap;
      chosen = candidate;
      chosenReach = boxRadius;
    }
  }
  if (chosen === null) return null;

  // Toward the box, which sits at the origin of this frame.
  const normal = dot(chosen, middle) > 0 ? negated(chosen) : chosen;

  // The two surfaces the report is placed between: the capsule's own, a radius
  // past the deepest point of its core, and the face of the box the pair leaves
  // through, which stands `chosenReach` along the leaving direction. Their
  // midpoint is a point in the middle of the contact region, which is the
  // "point on the shared boundary" the same way a box pair's midpoint of
  // supports is. Taking the middle of the core when its two ends lie equally
  // deep — every capsule lying flat against a face — keeps the report in the
  // middle of the contact rather than at whichever end was written first.
  const alongA = dot(a, normal);
  const alongB = dot(b, normal);
  const deepest =
    alongA > alongB ? a : alongB > alongA ? b : scale(add(a, b), 0.5);
  const onCapsule = add(deepest, scale(normal, capsule.radius));
  const onFace = add(
    deepest,
    scale(normal, -chosenReach - dot(deepest, normal)),
  );
  return {
    normal: directionToWorld(box, normal),
    depth,
    point: fromLocal(box, scale(add(onCapsule, onFace), 0.5)),
  };
}

/** A manifold computed the other way round, reported for this order. */
function flipped(manifold: Manifold | null): Manifold | null {
  if (manifold === null) return null;
  return {
    normal: negated(manifold.normal),
    depth: manifold.depth,
    point: manifold.point,
  };
}

/**
 * The manifold separating two world shapes, oriented from `a` toward `b`, or
 * `null` when they do not penetrate.
 *
 * Six pair tests cover the nine ordered combinations: the three mixed pairs are
 * written once, in the order their geometry is natural in, and read the other
 * way round through {@link flipped}.
 */
function manifoldOf(a: WorldShape, b: WorldShape): Manifold | null {
  if (a.kind === "sphere") {
    if (b.kind === "sphere") return sphereSphere(a, b);
    if (b.kind === "box") return sphereBox(a, b);
    return sphereCapsule(a, b);
  }
  if (a.kind === "capsule") {
    if (b.kind === "sphere") return flipped(sphereCapsule(b, a));
    if (b.kind === "box") return capsuleBox(a, b);
    return capsuleCapsule(a, b);
  }
  if (b.kind === "sphere") return flipped(sphereBox(b, a));
  if (b.kind === "capsule") return flipped(capsuleBox(b, a));
  return boxBox(a, b);
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
  return {
    t: 0,
    point: { x: origin.x, y: origin.y, z: origin.z },
    normal: negated(direction),
  };
}

/**
 * The nearest parameter at which the ray meets the sphere's surface within
 * `maxDistance`, or `null`. The entry root when the origin is outside, which is
 * the only case the capsule test below asks for — it has already ruled out an
 * origin inside the volume.
 */
function raySphereSurface(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  center: Vec3,
  radius: number,
): number | null {
  const toOrigin = sub(origin, center);
  const c = dot(toOrigin, toOrigin) - radius * radius;
  const b = dot(toOrigin, direction);
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = -b - root;
  const t = near >= 0 ? near : -b + root;
  if (t < 0 || t > maxDistance) return null;
  return t;
}

/** Where the ray first meets the sphere within `maxDistance`, or `null`. */
function raySphere(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  sphere: WorldSphere,
): RayHit | null {
  const toOrigin = sub(origin, sphere.center);
  if (dot(toOrigin, toOrigin) < sphere.radius * sphere.radius) {
    return insideHit(origin, direction);
  }
  const t = raySphereSurface(
    origin,
    direction,
    maxDistance,
    sphere.center,
    sphere.radius,
  );
  if (t === null) return null;
  const point = add(origin, scale(direction, t));
  return {
    t,
    point,
    normal: scale(sub(point, sphere.center), 1 / sphere.radius),
  };
}

/**
 * Where the ray first meets the oriented box within `maxDistance`, or `null`:
 * the classic slab test, run in the box's own frame where the six planes are
 * axis-aligned, with the entering slab's face supplying the surface normal.
 */
function rayBox(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  box: WorldBox,
): RayHit | null {
  const o = toLocal(box, origin);
  const d = directionToLocal(box, direction);
  let enter = -Infinity;
  let exit = Infinity;
  let normal: Vec3 | null = null;

  for (const [start, delta, half, axis] of [
    [o.x, d.x, box.half.x, LOCAL_X],
    [o.y, d.y, box.half.y, LOCAL_Y],
    [o.z, d.z, box.half.z, LOCAL_Z],
  ] as const) {
    if (delta === 0) {
      // Parallel to this slab: outside it means outside forever.
      if (Math.abs(start) > half) return null;
      continue;
    }
    const inverse = 1 / delta;
    let near = (-half - start) * inverse;
    let far = (half - start) * inverse;
    // A ray running along `+axis` enters through the `-half` face, whose
    // outward normal is `-axis`; one running the other way enters through
    // `+half`.
    let sign = -1;
    if (near > far) {
      [near, far] = [far, near];
      sign = 1;
    }
    if (near > enter) {
      enter = near;
      normal = scale(axis, sign);
    }
    if (far < exit) exit = far;
  }

  if (enter > exit || exit < 0) return null;
  if (enter < 0) return insideHit(origin, direction);
  if (enter > maxDistance || normal === null) return null;
  return {
    t: enter,
    point: add(origin, scale(direction, enter)),
    normal: directionToWorld(box, normal),
  };
}

/**
 * Where the ray first meets the capsule within `maxDistance`, or `null`.
 *
 * A capsule's surface is three pieces — the cylindrical body between the caps
 * and the two hemispheres — so the ray is tested against each and the nearest
 * valid meeting wins. Splitting it that way rather than solving the whole
 * surface at once is what keeps each piece's normal exact: the body's normal
 * runs out from the core segment, a cap's from its center.
 */
function rayCapsule(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  capsule: WorldCapsule,
): RayHit | null {
  const { a, b, radius } = capsule;
  const toSegment = sub(origin, closestOnSegment(a, b, origin));
  if (dot(toSegment, toSegment) < radius * radius) {
    return insideHit(origin, direction);
  }

  let best: RayHit | null = null;
  const consider = (hit: RayHit): void => {
    if (best === null || hit.t < best.t) best = hit;
  };

  const axis = sub(b, a);
  const axis2 = dot(axis, axis);
  if (axis2 > 0) {
    // The infinite cylinder about the core, then clamped to the core's extent.
    // `|direction|` is one, so `quadratic` is the squared sine of the angle
    // between the ray and the axis and is never negative; it vanishes only for
    // a ray running along the axis, whose meeting is on a cap.
    const m = sub(origin, a);
    const md = dot(m, axis);
    const nd = dot(direction, axis);
    const quadratic = axis2 - nd * nd;
    const linear = axis2 * dot(m, direction) - nd * md;
    const constant = axis2 * (dot(m, m) - radius * radius) - md * md;
    if (quadratic > 0) {
      const discriminant = linear * linear - quadratic * constant;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        for (const t of [
          (-linear - root) / quadratic,
          (-linear + root) / quadratic,
        ]) {
          if (t < 0 || t > maxDistance) continue;
          const along = md + t * nd;
          if (along < 0 || along > axis2) continue;
          const point = add(origin, scale(direction, t));
          const onAxis = add(a, scale(axis, along / axis2));
          consider({ t, point, normal: scale(sub(point, onAxis), 1 / radius) });
          break;
        }
      }
    }
  }

  // The two caps. A meeting on the cylinder side of a cap's plane is inside the
  // capsule rather than on it, so each cap only answers for its own hemisphere.
  for (const [center, outward] of [
    [a, -1],
    [b, 1],
  ] as const) {
    const t = raySphereSurface(origin, direction, maxDistance, center, radius);
    if (t === null) continue;
    const point = add(origin, scale(direction, t));
    if (dot(sub(point, center), axis) * outward < 0) continue;
    consider({ t, point, normal: scale(sub(point, center), 1 / radius) });
  }

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
      return raySphere(origin, direction, maxDistance, shape);
    case "box":
      return rayBox(origin, direction, maxDistance, shape);
    case "capsule":
      return rayCapsule(origin, direction, maxDistance, shape);
  }
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/** One collider a query found intersecting, with the actor that owns it. */
export interface Overlap {
  /** The actor the collider is attached to. */
  actor: Actor;
  /** The collider found. */
  collider: ColliderComponent;
}

/** One collider a ray met. */
export interface Hit {
  /** The actor the ray met. */
  actor: Actor;
  /** The collider on it the ray met. */
  collider: ColliderComponent;
  /** Where the ray meets the collider, in world units. */
  point: Vec3;
  /** The unit surface normal at `point`. */
  normal: Vec3;
  /** How far along the ray `point` lies, from `origin`. */
  distance: number;
}

/**
 * Puts a query on a channel and gives it a response map, so the query is
 * filtered by the same both-directions rule a pair of colliders is. A collider
 * the resolution leaves at `"ignore"` is left out of the result, and so is
 * every collider owned by an actor `ignore` names.
 */
export interface QueryOptions {
  /** The channel the query is on. Defaults to `"default"`. */
  channel?: string;
  /** How the query answers a collider on each named channel. */
  responses?: Readonly<Record<string, CollisionResponse>>;
  /** Actors whose colliders the query leaves out entirely. */
  ignore?: readonly Actor[];
}

/**
 * The world's collision queries, reached as `world.collision`.
 *
 * A query is answered from the colliders as they stand when it is called and
 * returns its result to the caller; the three collision events belong to the
 * frame's pass instead.
 */
export interface CollisionWorld {
  /** The colliders currently intersecting one of `actor`'s. */
  overlaps(actor: Actor): readonly Overlap[];
  /**
   * The colliders `shape` intersects when it is centered at `at` and turned by
   * `rotation`, which defaults to the identity. The shape is placed at unit
   * scale, so its fields are the world extents tested.
   */
  query(
    shape: ColliderShape,
    at: Vec3,
    rotation?: Quat,
    options?: QueryOptions,
  ): readonly Overlap[];
  /** The nearest hit along the ray, or `null`. */
  raycast(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    options?: QueryOptions,
  ): Hit | null;
  /** Every hit along the ray, in increasing `distance`. */
  raycastAll(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    options?: QueryOptions,
  ): readonly Hit[];
}

/* -------------------------------------------------------------------------- */
/* The collision system                                                       */
/* -------------------------------------------------------------------------- */

/** What an `overlap:begin` and an `overlap:end` carry. */
export interface CollisionPairEvent {
  a: Actor;
  b: Actor;
  colliders: [ColliderComponent, ColliderComponent];
}

/** What a `hit` carries: the pair, and the manifold separating it. */
export interface CollisionHitEvent extends CollisionPairEvent {
  manifold: Manifold;
}

/**
 * The three events the pass emits and the payload each carries.
 *
 * Stated here rather than taken from the engine's own event map because that
 * map names `Actor`, `Pawn`, `Controller`, and this module's own
 * `ColliderComponent`, and lives with the broadcaster that publishes it. The
 * engine's generic `emit` is assignable to the narrower one below, so the world
 * hands its broadcaster over unchanged.
 */
export interface CollisionEventMap {
  "overlap:begin": CollisionPairEvent;
  "overlap:end": CollisionPairEvent;
  hit: CollisionHitEvent;
}

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
  emit<K extends keyof CollisionEventMap>(
    event: K,
    payload: CollisionEventMap[K],
  ): void;
}

/** One collider taking part, with the actor that owns it. */
interface Entry {
  actor: Actor;
  collider: ColliderComponent;
}

/**
 * The engine's implementation of the {@link CollisionWorld} interface, and the
 * home of the frame's collision pass.
 *
 * Internal: the engine alone constructs it, one per world, and the world's
 * frame driver calls {@link pass} once per unpaused frame — after ticks and
 * timers, before the game mode — and {@link close} when the world closes. The
 * public query surface is the contract and is not to be reshaped.
 *
 * The only state the system holds is the set of overlapping pairs it has begun
 * and not yet ended, which is exactly the memory the `overlap:end` edge
 * requires. Everything else — every pass and every query — is answered from the
 * colliders as they stand at the moment of the call.
 */
export class CollisionSystem implements CollisionWorld {
  private readonly deps: CollisionDeps;

  /**
   * The overlapping pairs begun and not yet ended, keyed order-independently
   * per collider pair, each holding the payload it was begun with so its end
   * reports the same actors and colliders even after one of them has left the
   * world.
   */
  private active = new Map<string, CollisionPairEvent>();

  /**
   * Identity keys for colliders, handed out lazily. A pair's key joins the two
   * colliders' keys smallest-first, so the key is the same whichever order
   * enumeration happens to visit them in.
   */
  private readonly keys = new WeakMap<ColliderComponent, number>();
  private nextKey = 1;

  constructor(deps: CollisionDeps) {
    this.deps = deps;
  }

  /**
   * The frame's pass: test every pair the responses do not ignore, emit `hit`
   * for each blocking pair found, `overlap:begin` for each overlapping pair not
   * already held, and `overlap:end` for each held pair no longer found — which
   * covers separation, a collider disabled or reshaped, and an actor destroyed,
   * since a destroyed actor's colliders are simply no longer enumerated.
   *
   * Events for found pairs are emitted in enumeration order — actors in spawn
   * order, colliders in attachment order — and the frame's ends after them, in
   * the order the pairs were begun, so a frame's report is deterministic.
   * Within a pair the actor with the lower `id` is reported first, which the
   * manifold is oriented by; a world that hands actors over in spawn order is
   * already handing them over in `id` order, so the two agree, and reading the
   * `id` rather than the position makes the report independent of that.
   *
   * The colliders are snapshotted once at the top of the pass: a handler that
   * destroys an actor mid-pass changes next frame's pass, not this one's.
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

    const found = new Map<string, CollisionPairEvent>();
    for (let i = 0; i < entries.length; i += 1) {
      const first = entries[i]!;
      const firstShape = shapes[i];
      if (!firstShape) continue;
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
        if (!secondShape) continue;
        if (!boundsOverlap(boxes[i]!, boxes[j]!)) continue;

        const ordered = first.actor.id <= second.actor.id;
        const low = ordered ? first : second;
        const high = ordered ? second : first;
        const manifold = ordered
          ? manifoldOf(firstShape, secondShape)
          : manifoldOf(secondShape, firstShape);
        if (manifold === null) continue;

        const payload: CollisionPairEvent = {
          a: low.actor,
          b: high.actor,
          colliders: [low.collider, high.collider],
        };
        if (response === "block") {
          this.deps.emit("hit", { ...payload, manifold });
        } else {
          const key = this.pairKey(first.collider, second.collider);
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
   * The colliders currently intersecting one of `actor`'s, each with the actor
   * that owns it.
   *
   * Filtered by the same both-directions rule the pass applies — a pair the
   * responses resolve to `ignore` is never tested, so it does not appear here
   * either — and answered from the colliders as they stand now, independent of
   * what the last pass reported. A collider intersecting two of the actor's
   * colliders appears once.
   */
  overlaps(actor: Actor): readonly Overlap[] {
    if (!actor.alive) return [];
    const mine: {
      collider: ColliderComponent;
      shape: WorldShape;
      box: Box3;
    }[] = [];
    for (const component of actor.components) {
      if (!(component instanceof ColliderComponent) || !component.enabled) {
        continue;
      }
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
   * The colliders `shape` intersects when it is centered at `at` and turned by
   * `rotation`. The queried shape is placed at unit scale, so its fields are
   * the world extents tested and no actor's scale reaches it.
   */
  query(
    shape: ColliderShape,
    at: Vec3,
    rotation?: Quat,
    options?: QueryOptions,
  ): readonly Overlap[] {
    const placed = toWorld(shape, {
      position: at,
      rotation: rotation ?? QUAT_IDENTITY,
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
   * The nearest hit along the ray, or `null`. `direction` is a unit vector and
   * `distance` bounds the ray's length, in world units. A tie in distance goes
   * to the collider enumerated first, so the answer is deterministic.
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
   * each at the point the ray first meets it. Equal distances keep enumeration
   * order.
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
   * spawn order and colliders in attachment order — the enumeration order the
   * pass's reports and the queries' results are stated in. `alive` is checked
   * here even though `actors()` promises live actors, because an actor
   * destroyed this frame is out of the pass at once while it leaves the world
   * only at the frame's end.
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
   * something stronger than `ignore`, the owning actor is not in `ignore`, and
   * the shape is not degenerate — handing each to `fn` with its world shape and
   * bounds.
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
