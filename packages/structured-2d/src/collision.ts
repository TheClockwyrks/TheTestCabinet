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
 * The geometry model, stated once because every test below leans on it:
 *
 * - A shape is carried into world space by the component's `worldTransform()`
 *   — the actor's transform composed with the component's `offset` — so a
 *   collider follows its actor the way a drawn component does. A rect and a
 *   polygon become world-space convex polygons (rotation and scale included);
 *   a circle stays a circle, its radius scaled by the larger magnitude of the
 *   two scale factors, so a non-uniformly scaled circle is approximated by the
 *   circle that encloses the ellipse it would be.
 * - Two shapes collide when they *penetrate*: a pair exactly touching, with
 *   zero depth, is not reported. That keeps a wall of adjacent tiles from
 *   reporting a hit per shared edge every frame.
 * - A degenerate shape — a circle of zero radius, a rect with a zero side, a
 *   polygon with fewer than three distinct points or zero area — takes part in
 *   nothing: it cannot penetrate, so testing it would only manufacture
 *   ambiguous manifolds. A polygon is assumed convex; the manifold and the ray
 *   math treat a concave one as if it were.
 */

import { Component } from "./components";
import type {
  ColliderOptions,
  CollisionResponse,
  CollisionWorld,
  EngineEventMap,
  Hit,
  Manifold,
  Overlap,
  QueryOptions,
  Rect,
  Shape,
  Transform,
  Vec2,
} from "./contract";
import type { Actor } from "./actors";

/**
 * Gives its actor a shape the engine tests, positioned by the component's
 * world transform — the actor's transform composed with the component's
 * `offset`, so one actor carries several colliders at different offsets.
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
  shape: Shape;

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
   * The axis-aligned rectangle enclosing the shape at the component's world
   * transform, in world units.
   *
   * Unlike the pass, `bounds()` answers for a degenerate shape too — the
   * enclosing rectangle of a zero-area shape is a zero-sized rectangle at its
   * position, which is still the honest answer to "where is this".
   */
  bounds(): Rect {
    return shapeBounds(this.shape, this.worldTransform());
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

/** A circle carried into world space. */
interface WorldCircle {
  kind: "circle";
  center: Vec2;
  radius: number;
}

/**
 * A convex polygon carried into world space, with the derived values every
 * test needs: one outward unit normal per edge (`normals[i]` belongs to the
 * edge from `points[i]` to `points[i + 1]`) and the centroid the normals were
 * oriented against — orientation by centroid rather than by winding, so a
 * negative scale flipping the winding cannot turn the polygon inside out.
 */
interface WorldPolygon {
  kind: "polygon";
  points: readonly Vec2[];
  normals: readonly Vec2[];
  centroid: Vec2;
}

type WorldShape = WorldCircle | WorldPolygon;

/** `point` carried through `transform`: scaled, rotated, then translated. */
function apply(transform: Transform, point: Vec2): Vec2 {
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  const x = point.x * transform.scaleX;
  const y = point.y * transform.scaleY;
  return {
    x: transform.x + x * cos - y * sin,
    y: transform.y + x * sin + y * cos,
  };
}

/** The four corners of a centered `width` × `height` rect, in local units. */
function rectCorners(width: number, height: number): Vec2[] {
  const w = width / 2;
  const h = height / 2;
  return [
    { x: -w, y: -h },
    { x: w, y: -h },
    { x: w, y: h },
    { x: -w, y: h },
  ];
}

/**
 * Builds the world polygon from transformed points, or `null` when the result
 * is degenerate: fewer than three distinct points, or zero area (collinear
 * points, a zero-sized rect). Each edge's normal is the edge's perpendicular,
 * oriented away from the centroid, which is direction enough for a convex
 * polygon whatever its winding.
 */
function makePolygon(transformed: readonly Vec2[]): WorldPolygon | null {
  // Collapse consecutive duplicates (a zero-length edge has no normal), the
  // wrap-around pair included.
  const points: Vec2[] = [];
  for (const p of transformed) {
    const last = points[points.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    points.push(p);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (
    points.length > 1 &&
    first &&
    last &&
    first.x === last.x &&
    first.y === last.y
  ) {
    points.pop();
  }
  if (points.length < 3) return null;

  // Shoelace area: zero means the points are collinear and the "polygon" is a
  // segment, which penetrates nothing.
  let doubled = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    doubled += p.x * q.y - q.x * p.y;
  }
  if (doubled === 0) return null;

  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  const centroid = { x: cx / points.length, y: cy / points.length };

  const normals: Vec2[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const length = Math.hypot(ex, ey);
    let nx = ey / length;
    let ny = -ex / length;
    // Away from the centroid, so the normal is outward regardless of winding.
    const mx = (p.x + q.x) / 2 - centroid.x;
    const my = (p.y + q.y) / 2 - centroid.y;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    normals.push({ x: nx, y: ny });
  }

  return { kind: "polygon", points, normals, centroid };
}

/**
 * Carries `shape` into world space through `transform`, or `null` when the
 * result is degenerate and takes part in nothing.
 */
function toWorld(shape: Shape, transform: Transform): WorldShape | null {
  switch (shape.kind) {
    case "circle": {
      // A non-uniform scale would make an ellipse; the enclosing circle is
      // the approximation, so the radius takes the larger scale magnitude.
      const radius =
        Math.abs(shape.radius) *
        Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
      if (radius <= 0) return null;
      return {
        kind: "circle",
        center: { x: transform.x, y: transform.y },
        radius,
      };
    }
    case "rect":
      return makePolygon(
        rectCorners(shape.width, shape.height).map((p) => apply(transform, p)),
      );
    case "polygon":
      return makePolygon(shape.points.map((p) => apply(transform, p)));
  }
}

/** The axis-aligned bounds of `shape` at `transform`, degenerate or not. */
function shapeBounds(shape: Shape, transform: Transform): Rect {
  if (shape.kind === "circle") {
    const radius =
      Math.abs(shape.radius) *
      Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
    return {
      x: transform.x - radius,
      y: transform.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
  }
  const local =
    shape.kind === "rect"
      ? rectCorners(shape.width, shape.height)
      : shape.points;
  if (local.length === 0) {
    return { x: transform.x, y: transform.y, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of local) {
    const w = apply(transform, p);
    minX = Math.min(minX, w.x);
    minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x);
    maxY = Math.max(maxY, w.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The axis-aligned bounds of a world shape, for the broad phase. */
function worldBounds(shape: WorldShape): Rect {
  if (shape.kind === "circle") {
    return {
      x: shape.center.x - shape.radius,
      y: shape.center.y - shape.radius,
      width: shape.radius * 2,
      height: shape.radius * 2,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of shape.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Whether two bounds overlap with positive area. Strict, to match the strict
 * narrow phase: shapes that merely share an edge cannot penetrate.
 */
function boundsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/* -------------------------------------------------------------------------- */
/* Manifolds                                                                  */
/* -------------------------------------------------------------------------- */

/** Circle against circle, normal from `a` toward `b`. */
function circleCircle(a: WorldCircle, b: WorldCircle): Manifold | null {
  const dx = b.center.x - a.center.x;
  const dy = b.center.y - a.center.y;
  const sum = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= sum * sum) return null;
  const d = Math.sqrt(d2);
  // Concentric circles have no separating direction of their own; any unit
  // vector separates them, so pick a fixed one and keep the report
  // deterministic.
  const normal = d > 0 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
  const depth = sum - d;
  // The midpoint of the lens the two boundaries cut off along the axis.
  const along = a.radius - depth / 2;
  return {
    normal,
    depth,
    point: {
      x: a.center.x + normal.x * along,
      y: a.center.y + normal.y * along,
    },
  };
}

/** The interval `polygon` covers when projected onto `axis`. */
function project(
  polygon: WorldPolygon,
  axis: Vec2,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of polygon.points) {
    const d = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { min, max };
}

/**
 * Polygon against polygon by separating axes, normal from `a` toward `b`.
 *
 * The manifold's normal is the axis of least overlap, oriented by the centroid
 * difference; its point is the midpoint between the deepest vertex of each
 * polygon along that axis — a point in the middle of the contact region, which
 * is the "point on the shared boundary" a game aims a particle or a sound at.
 */
function polygonPolygon(a: WorldPolygon, b: WorldPolygon): Manifold | null {
  let depth = Infinity;
  let axis: Vec2 | null = null;
  for (const candidate of [...a.normals, ...b.normals]) {
    const pa = project(a, candidate);
    const pb = project(b, candidate);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return null;
    if (overlap < depth) {
      depth = overlap;
      axis = candidate;
    }
  }
  if (axis === null) return null;

  let nx = axis.x;
  let ny = axis.y;
  const cx = b.centroid.x - a.centroid.x;
  const cy = b.centroid.y - a.centroid.y;
  if (nx * cx + ny * cy < 0) {
    nx = -nx;
    ny = -ny;
  }

  let supportA: Vec2 = a.points[0]!;
  let bestA = -Infinity;
  for (const p of a.points) {
    const d = p.x * nx + p.y * ny;
    if (d > bestA) {
      bestA = d;
      supportA = p;
    }
  }
  let supportB: Vec2 = b.points[0]!;
  let bestB = Infinity;
  for (const p of b.points) {
    const d = p.x * nx + p.y * ny;
    if (d < bestB) {
      bestB = d;
      supportB = p;
    }
  }

  return {
    normal: { x: nx, y: ny },
    depth,
    point: {
      x: (supportA.x + supportB.x) / 2,
      y: (supportA.y + supportB.y) / 2,
    },
  };
}

/** The closest point to `target` on the segment from `p` to `q`. */
function closestOnSegment(p: Vec2, q: Vec2, target: Vec2): Vec2 {
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const length2 = ex * ex + ey * ey;
  if (length2 === 0) return { x: p.x, y: p.y };
  const t = Math.max(
    0,
    Math.min(1, ((target.x - p.x) * ex + (target.y - p.y) * ey) / length2),
  );
  return { x: p.x + ex * t, y: p.y + ey * t };
}

/**
 * Circle against polygon by closest point, normal from the circle toward the
 * polygon.
 *
 * Two regimes: a center outside the polygon separates along the line to the
 * closest boundary point; a center inside separates through the nearest edge,
 * which is the direction that pushes the circle out the shortest way.
 */
function circlePolygon(
  circle: WorldCircle,
  polygon: WorldPolygon,
): Manifold | null {
  const c = circle.center;

  // Signed distance of the center past each edge's outward plane; inside is
  // every one of them non-positive. The nearest edge (the greatest signed
  // distance) serves both regimes.
  let nearest = -Infinity;
  let nearestEdge = 0;
  let inside = true;
  for (let i = 0; i < polygon.points.length; i += 1) {
    const n = polygon.normals[i]!;
    const p = polygon.points[i]!;
    const d = (c.x - p.x) * n.x + (c.y - p.y) * n.y;
    if (d > 0) inside = false;
    if (d > nearest) {
      nearest = d;
      nearestEdge = i;
    }
  }

  if (inside) {
    const n = polygon.normals[nearestEdge]!;
    // The circle leaves through the nearest edge along +n, so the manifold's
    // first-toward-second normal is -n; `nearest` is non-positive here, so the
    // depth is the radius plus how far the center already sits inside.
    return {
      normal: { x: -n.x, y: -n.y },
      depth: circle.radius - nearest,
      point: { x: c.x - n.x * nearest, y: c.y - n.y * nearest },
    };
  }

  let closest: Vec2 = polygon.points[0]!;
  let closestD2 = Infinity;
  for (let i = 0; i < polygon.points.length; i += 1) {
    const p = polygon.points[i]!;
    const q = polygon.points[(i + 1) % polygon.points.length]!;
    const candidate = closestOnSegment(p, q, c);
    const dx = candidate.x - c.x;
    const dy = candidate.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < closestD2) {
      closestD2 = d2;
      closest = candidate;
    }
  }
  const d = Math.sqrt(closestD2);
  if (d >= circle.radius) return null;
  // A center exactly on the boundary has no line to separate along; the
  // nearest edge's outward normal stands in.
  const normal =
    d > 0
      ? { x: (closest.x - c.x) / d, y: (closest.y - c.y) / d }
      : {
          x: -polygon.normals[nearestEdge]!.x,
          y: -polygon.normals[nearestEdge]!.y,
        };
  return { normal, depth: circle.radius - d, point: closest };
}

/**
 * The manifold separating two world shapes, oriented from `a` toward `b`, or
 * `null` when they do not penetrate.
 */
function manifoldOf(a: WorldShape, b: WorldShape): Manifold | null {
  if (a.kind === "circle" && b.kind === "circle") return circleCircle(a, b);
  if (a.kind === "circle" && b.kind === "polygon") return circlePolygon(a, b);
  if (a.kind === "polygon" && b.kind === "circle") {
    const m = circlePolygon(b, a);
    if (m === null) return null;
    // Computed circle-toward-polygon, which is second-toward-first here.
    return {
      normal: { x: -m.normal.x, y: -m.normal.y },
      depth: m.depth,
      point: m.point,
    };
  }
  return polygonPolygon(a as WorldPolygon, b as WorldPolygon);
}

/* -------------------------------------------------------------------------- */
/* Rays                                                                      */
/* -------------------------------------------------------------------------- */

/** Where a ray meets one shape: the parameter along the ray and the normal. */
interface RayHit {
  t: number;
  point: Vec2;
  normal: Vec2;
}

/**
 * A hit at the origin, for a ray that starts inside a shape. There is no
 * surface under the origin to take a normal from, so the normal faces back
 * along the ray — the direction that leaves the shape the way the ray came in.
 */
function insideHit(origin: Vec2, direction: Vec2): RayHit {
  // `|| 0` turns the `-0` a negated zero component produces back into `0`, so
  // the reported normal serializes and compares as the plain value it means.
  return {
    t: 0,
    point: { x: origin.x, y: origin.y },
    normal: { x: -direction.x || 0, y: -direction.y || 0 },
  };
}

/** Where the ray first meets the circle within `maxDistance`, or `null`. */
function rayCircle(
  origin: Vec2,
  direction: Vec2,
  maxDistance: number,
  circle: WorldCircle,
): RayHit | null {
  const ox = origin.x - circle.center.x;
  const oy = origin.y - circle.center.y;
  const c = ox * ox + oy * oy - circle.radius * circle.radius;
  if (c < 0) return insideHit(origin, direction);
  const b = ox * direction.x + oy * direction.y;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxDistance) return null;
  const point = {
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
  };
  return {
    t,
    point,
    normal: {
      x: (point.x - circle.center.x) / circle.radius,
      y: (point.y - circle.center.y) / circle.radius,
    },
  };
}

/**
 * Where the ray first meets the convex polygon within `maxDistance`, or
 * `null`: the ray is clipped against each edge's half-plane, and the latest
 * entry against the earliest exit decides. The entering edge's outward normal
 * is the surface normal at the hit.
 */
function rayPolygon(
  origin: Vec2,
  direction: Vec2,
  maxDistance: number,
  polygon: WorldPolygon,
): RayHit | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  let normal: Vec2 | null = null;
  for (let i = 0; i < polygon.points.length; i += 1) {
    const n = polygon.normals[i]!;
    const p = polygon.points[i]!;
    const denom = n.x * direction.x + n.y * direction.y;
    const dist = (origin.x - p.x) * n.x + (origin.y - p.y) * n.y;
    if (denom === 0) {
      // Parallel to the edge: outside its half-plane means outside forever.
      if (dist > 0) return null;
      continue;
    }
    const t = -dist / denom;
    if (denom < 0) {
      if (t > tEnter) {
        tEnter = t;
        normal = n;
      }
    } else if (t < tExit) {
      tExit = t;
    }
  }
  if (tEnter > tExit || tExit < 0) return null;
  if (tEnter < 0) return insideHit(origin, direction);
  if (tEnter > maxDistance || normal === null) return null;
  return {
    t: tEnter,
    point: {
      x: origin.x + direction.x * tEnter,
      y: origin.y + direction.y * tEnter,
    },
    normal: { x: normal.x, y: normal.y },
  };
}

/** Where the ray first meets `shape` within `maxDistance`, or `null`. */
function rayShape(
  origin: Vec2,
  direction: Vec2,
  maxDistance: number,
  shape: WorldShape,
): RayHit | null {
  return shape.kind === "circle"
    ? rayCircle(origin, direction, maxDistance, shape)
    : rayPolygon(origin, direction, maxDistance, shape);
}

/* -------------------------------------------------------------------------- */
/* The collision system                                                       */
/* -------------------------------------------------------------------------- */

/** The three events the pass emits, out of the whole map. */
type CollisionEventName = "overlap:begin" | "overlap:end" | "hit";

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
    payload: EngineEventMap[K],
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
 * The engine's implementation of the `CollisionWorld` interface, and the home
 * of the frame's collision pass.
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
   * Events for found pairs are emitted in enumeration order — actors in spawn
   * order, colliders in attachment order — and the frame's ends after them,
   * in the order the pairs were begun, so a frame's report is deterministic.
   * The colliders are snapshotted once at the top of the pass: a handler that
   * destroys an actor mid-pass changes next frame's pass, not this one's.
   */
  pass(): void {
    const entries = this.collect();
    const shapes: (WorldShape | null)[] = [];
    const boxes: (Rect | null)[] = [];
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
        const manifold = manifoldOf(firstShape, secondShape);
        if (manifold === null) continue;

        const payload: ActivePair = {
          a: first.actor,
          b: second.actor,
          colliders: [first.collider, second.collider],
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
      box: Rect;
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
      let otherBox: Rect | undefined;
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

  /** The colliders `shape` intersects when it is placed at `at`. */
  query(shape: Shape, at: Vec2, options?: QueryOptions): readonly Overlap[] {
    const placed = toWorld(shape, {
      x: at.x,
      y: at.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
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
    origin: Vec2,
    direction: Vec2,
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
    origin: Vec2,
    direction: Vec2,
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
   * something stronger than `ignore`, the owning actor is not in `ignore`,
   * and the shape is not degenerate — handing each to `fn` with its world
   * shape and bounds.
   */
  private candidates(
    options: QueryOptions | undefined,
    fn: (entry: Entry, shape: WorldShape, box: Rect) => void,
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
