// The crane as a structure: what the ring puts on the lattice, which half of
// the crane a node belongs to, the track the rails form, the cost, readiness,
// and every rule the editor of `specs/structure.md` refuses an edit by.

import { COUNTERWEIGHT_COST, LATTICE_PITCH, RING_COST } from "../constants";
import { segmentStrikesAny } from "./collide";
import { MATERIALS } from "./materials";
import { insideEnvelope } from "./site";
import type {
  Material,
  Member,
  ReadinessIssue,
  Ring,
  SimSite,
  Structure,
} from "./types";
import {
  type Axis2,
  distance,
  dot,
  length,
  nodeKey,
  scale,
  sub,
  type Vec3,
  vec3,
} from "./vec";

/** A member's length: the distance between its ends. */
export const memberLength = (m: Member): number => distance(m.b, m.a);

/**
 * A crane's cost: each member's length times its material's cost per unit, plus
 * `RING_COST` for the ring, plus `COUNTERWEIGHT_COST` per counterweight.
 */
export function cost(structure: Structure): number {
  let total = 0;
  for (const m of structure.members) {
    total += memberLength(m) * MATERIALS[m.material].costPerUnit;
  }
  if (structure.ring) total += RING_COST;
  total += structure.counterweights.length * COUNTERWEIGHT_COST;
  return total;
}

/** The ring's eight nodes: the bottom flange, and the top flange above it. */
export interface FlangeNodes {
  readonly bottom: readonly Vec3[];
  readonly top: readonly Vec3[];
}

const FLANGE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [LATTICE_PITCH, 0],
  [0, LATTICE_PITCH],
  [LATTICE_PITCH, LATTICE_PITCH],
];

/**
 * The ring's flange nodes, bottom and top, in one fixed order. Index `i` of the
 * two lists is one ring corner: the pairing is the ring's own and holds at
 * every slew angle (`specs/structure.md`).
 */
export function flangeNodes(ring: Structure["ring"]): FlangeNodes {
  if (!ring) return { bottom: [], top: [] };
  const [x, y, z] = ring.corner;
  return {
    bottom: FLANGE_OFFSETS.map(([dx, dz]) => vec3(x + dx, y, z + dz)),
    top: FLANGE_OFFSETS.map(([dx, dz]) =>
      vec3(x + dx, y + LATTICE_PITCH, z + dz),
    ),
  };
}

/** The vertical line through the flange square's center. */
export function slewAxis(ring: Ring): Axis2 {
  return [
    ring.corner[0] + LATTICE_PITCH / 2,
    ring.corner[2] + LATTICE_PITCH / 2,
  ];
}

/** Which half of the crane each node belongs to (`specs/structure.md`). */
export interface Partition {
  /** Reached from an anchor or from the bottom flange: it stands still. */
  readonly towerSet: ReadonlySet<string>;
  /** Reached from the top flange: it turns with the slew angle. */
  readonly armSet: ReadonlySet<string>;
  readonly bottom: readonly Vec3[];
  readonly top: readonly Vec3[];
}

/**
 * The reachability partition: everything joined through intact members to the
 * top flange is the arm, everything joined to the bottom flange or to an anchor
 * is the tower.
 */
export function partition(
  structure: Structure,
  anchors: readonly Vec3[],
): Partition {
  const { bottom, top } = flangeNodes(structure.ring);
  const adjacency = new Map<string, string[]>();
  const touch = (k: string): string[] => {
    let list = adjacency.get(k);
    if (!list) {
      list = [];
      adjacency.set(k, list);
    }
    return list;
  };
  for (const m of structure.members) {
    touch(nodeKey(m.a)).push(nodeKey(m.b));
    touch(nodeKey(m.b)).push(nodeKey(m.a));
  }
  for (const n of [...bottom, ...top, ...anchors]) touch(nodeKey(n));

  const reach = (seeds: readonly Vec3[]): Set<string> => {
    const seen = new Set<string>();
    const queue = seeds.map(nodeKey).filter((k) => adjacency.has(k));
    for (const k of queue) seen.add(k);
    for (let head = 0; head < queue.length; head++) {
      const k = queue[head];
      for (const next of adjacency.get(k) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };

  return {
    towerSet: reach([...anchors, ...bottom]),
    armSet: reach(top),
    bottom,
    top,
  };
}

/**
 * Whether some path of members already runs between a bottom-flange or anchor
 * node and a top-flange node — the join the ring rule forbids anywhere but
 * through the ring. A crane with no ring has neither half, so it breaks nothing.
 */
export function linksArmToTower(
  structure: Structure,
  anchors: readonly Vec3[],
): boolean {
  if (!structure.ring) return false;
  const { towerSet, armSet } = partition(structure, anchors);
  for (const k of towerSet) if (armSet.has(k)) return true;
  return false;
}

/** The same question, asked of the structure with one more member in it. */
export function wouldLinkArmTower(
  structure: Structure,
  anchors: readonly Vec3[],
  a: Vec3,
  b: Vec3,
): boolean {
  if (!structure.ring) return false;
  const probe: Member = { id: -1, a, b, material: "strut" };
  return linksArmToTower(
    { ...structure, members: [...structure.members, probe] },
    anchors,
  );
}

/** One rail member's stretch of the track, measured from the origin. */
export interface RailSpan {
  readonly member: Member;
  /** The end nearer the origin, along the track. */
  readonly s0: number;
  readonly s1: number;
  /** The member's own ends, ordered to match `s0` and `s1`. */
  readonly nodeA: Vec3;
  readonly nodeB: Vec3;
}

/** The track the rails form, when they form one. */
export interface RailTrack {
  readonly ok: true;
  readonly origin: Vec3;
  readonly far: Vec3;
  /** Unit, origin end toward far end. */
  readonly direction: Vec3;
  readonly length: number;
  /** In ascending order along the track. */
  readonly spans: readonly RailSpan[];
  /** The track's nodes, in ascending order along it. */
  readonly nodes: readonly Vec3[];
}

/** Why the rails form no track — or, with no ring, that they went unjudged. */
export interface NoRailTrack {
  readonly ok: false;
  readonly issue: "no-rail" | "no-ring" | "invalid-rail";
}

export type RailTrackResult = RailTrack | NoRailTrack;

const invalidRail: NoRailTrack = { ok: false, issue: "invalid-rail" };

/**
 * The trolley's track, from the rail members that remain.
 *
 * `specs/structure.md`: every rail is horizontal, all of them are collinear and
 * cover one unbroken stretch of that line exactly once, every one is in the
 * arm, and the track's two end nodes lie at distinct horizontal distances from
 * the slew axis. The last two rules speak of the arm and the slew axis, so a
 * crane with no ring has neither and the track goes UNJUDGED: that test comes
 * before the partition, which without a ring seeds an empty arm and would
 * answer `invalid-rail` on the first rail.
 */
export function railTrack(
  structure: Structure,
  anchors: readonly Vec3[],
): RailTrackResult {
  const rails = structure.members.filter((m) => m.material === "rail");
  if (rails.length === 0) return { ok: false, issue: "no-rail" };
  const ring = structure.ring;
  if (!ring) return { ok: false, issue: "no-ring" };

  const { armSet } = partition(structure, anchors);
  for (const m of rails) {
    if (m.a[1] !== m.b[1]) return invalidRail;
    if (!armSet.has(nodeKey(m.a)) || !armSet.has(nodeKey(m.b)))
      return invalidRail;
  }

  // Collinearity on the integer lattice, so the cross products are exact.
  const lattice = (p: Vec3): Vec3 => [
    p[0] / LATTICE_PITCH,
    p[1] / LATTICE_PITCH,
    p[2] / LATTICE_PITCH,
  ];
  const base = lattice(rails[0].a);
  const along = sub(lattice(rails[0].b), base);
  const cross = (u: Vec3, w: Vec3): Vec3 => [
    u[1] * w[2] - u[2] * w[1],
    u[2] * w[0] - u[0] * w[2],
    u[0] * w[1] - u[1] * w[0],
  ];
  const nodes = new Map<string, Vec3>();
  for (const m of rails) {
    nodes.set(nodeKey(m.a), m.a);
    nodes.set(nodeKey(m.b), m.b);
  }
  for (const p of nodes.values()) {
    const c = cross(sub(lattice(p), base), along);
    if (c[0] !== 0 || c[1] !== 0 || c[2] !== 0) return invalidRail;
  }

  // They meet end to end: a path graph over `n + 1` nodes with two ends.
  const degree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const m of rails) {
    for (const [u, w] of [
      [m.a, m.b],
      [m.b, m.a],
    ]) {
      const ku = nodeKey(u);
      degree.set(ku, (degree.get(ku) ?? 0) + 1);
      let list = adjacency.get(ku);
      if (!list) {
        list = [];
        adjacency.set(ku, list);
      }
      list.push(nodeKey(w));
    }
  }
  const ends: string[] = [];
  for (const [k, d] of degree) {
    if (d > 2) return invalidRail;
    if (d === 1) ends.push(k);
  }
  if (ends.length !== 2) return invalidRail;
  const seen = new Set<string>([ends[0]]);
  const queue = [ends[0]];
  for (let head = 0; head < queue.length; head++) {
    for (const next of adjacency.get(queue[head]) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  if (seen.size !== nodes.size) return invalidRail;
  if (rails.length !== nodes.size - 1) return invalidRail;

  // The end nearer the slew axis is the origin, and the two ends must differ.
  const axis = slewAxis(ring);
  const horizontal2 = (k: string): number => {
    const p = nodes.get(k) as Vec3;
    const dx = p[0] - axis[0];
    const dz = p[2] - axis[1];
    return dx * dx + dz * dz;
  };
  if (horizontal2(ends[0]) === horizontal2(ends[1])) return invalidRail;
  const nearer = horizontal2(ends[0]) < horizontal2(ends[1]) ? 0 : 1;
  const origin = nodes.get(ends[nearer]) as Vec3;
  const far = nodes.get(ends[1 - nearer]) as Vec3;
  const trackLength = distance(far, origin);
  const direction = scale(sub(far, origin), 1 / trackLength);

  const spans: RailSpan[] = rails.map((member) => {
    const sa = dot(sub(member.a, origin), direction);
    const sb = dot(sub(member.b, origin), direction);
    return {
      member,
      s0: Math.min(sa, sb),
      s1: Math.max(sa, sb),
      nodeA: sa <= sb ? member.a : member.b,
      nodeB: sa <= sb ? member.b : member.a,
    };
  });
  spans.sort((x, y) => x.s0 - y.s0);

  // The path graph above reads node identity rather than position, so on its
  // own it admits a set that doubles back through a shared node or nests one
  // rail inside another. `specs/structure.md` asks for one unbroken stretch
  // covered EXACTLY ONCE, so require the spans to tile `[0, length]`.
  const eps = 1e-9 * Math.max(1, trackLength);
  if (Math.abs(spans[0].s0) > eps) return invalidRail;
  if (Math.abs(spans[spans.length - 1].s1 - trackLength) > eps)
    return invalidRail;
  for (let i = 0; i + 1 < spans.length; i++) {
    if (Math.abs(spans[i].s1 - spans[i + 1].s0) > eps) return invalidRail;
  }

  const ordered = [...nodes.values()]
    .map((p) => ({ p, s: dot(sub(p, origin), direction) }))
    .sort((x, y) => x.s - y.s)
    .map((entry) => entry.p);

  return {
    ok: true,
    origin,
    far,
    direction,
    length: trackLength,
    spans,
    nodes: ordered,
  };
}

/** The track's current length, which is the trolley axis's upper bound. */
export function trackLength(
  structure: Structure,
  anchors: readonly Vec3[],
): number {
  const track = railTrack(structure, anchors);
  return track.ok ? track.length : 0;
}

/**
 * The readiness issues of `specs/structure.md`, in the order that file lists
 * them: `no-ring`, `no-rail`, `invalid-rail`, `disconnected-members`.
 */
export function readiness(
  structure: Structure,
  anchors: readonly Vec3[],
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  if (!structure.ring) issues.push("no-ring");
  const rails = structure.members.filter((m) => m.material === "rail");
  if (rails.length === 0) issues.push("no-rail");
  else if (structure.ring) {
    if (!railTrack(structure, anchors).ok) issues.push("invalid-rail");
  }
  const { towerSet, armSet } = partition(structure, anchors);
  for (const m of structure.members) {
    const ka = nodeKey(m.a);
    const kb = nodeKey(m.b);
    const inTower = towerSet.has(ka) || towerSet.has(kb);
    const inArm = armSet.has(ka) || armSet.has(kb);
    if (!inTower && !inArm) {
      issues.push("disconnected-members");
      break;
    }
  }
  return issues;
}

/**
 * The nodes the structure uses: a node a member ends at, or a flange node of the
 * ring. It is the set a counterweight may go on, and the set a solve builds
 * over (`specs/statics.md`).
 */
export function usedNodes(structure: Structure): Set<string> {
  const used = new Set<string>();
  const { bottom, top } = flangeNodes(structure.ring);
  for (const n of [...bottom, ...top]) used.add(nodeKey(n));
  for (const m of structure.members) {
    used.add(nodeKey(m.a));
    used.add(nodeKey(m.b));
  }
  return used;
}

/** Why the editor refused an edit. Every one is a rule of `specs/structure.md`. */
export type EditRefusal =
  | "off-lattice"
  | "outside-envelope"
  | "same-node"
  | "too-long"
  | "duplicate"
  | "inside-obstacle"
  | "rail-not-horizontal"
  | "links-arm-tower"
  | "over-budget"
  | "ring-exists"
  | "ring-on-ground"
  | "node-unused"
  | "counterweight-exists";

/** Whether every coordinate is an integer multiple of the lattice pitch. */
export const onLattice = (p: Vec3): boolean =>
  p[0] % LATTICE_PITCH === 0 &&
  p[1] % LATTICE_PITCH === 0 &&
  p[2] % LATTICE_PITCH === 0;

/** Whether two members join the same two nodes, in either direction. */
const sameEnds = (m: Member, a: Vec3, b: Vec3): boolean => {
  const ka = nodeKey(a);
  const kb = nodeKey(b);
  const ma = nodeKey(m.a);
  const mb = nodeKey(m.b);
  return (ma === ka && mb === kb) || (ma === kb && mb === ka);
};

/**
 * The member placement rules, in the order `specs/structure.md` lists them.
 * Returns the refusal, or `null` when the placement stands.
 */
export function checkMemberPlacement(
  site: SimSite,
  structure: Structure,
  a: Vec3,
  b: Vec3,
  material: Material,
): EditRefusal | null {
  if (!onLattice(a) || !onLattice(b)) return "off-lattice";
  if (!insideEnvelope(site.envelope, a) || !insideEnvelope(site.envelope, b)) {
    return "outside-envelope";
  }
  const l = length(sub(b, a));
  if (l === 0) return "same-node";
  if (l > MATERIALS[material].maxLength + 1e-9) return "too-long";
  for (const m of structure.members) if (sameEnds(m, a, b)) return "duplicate";
  if (segmentStrikesAny(a, b, site.obstacles)) return "inside-obstacle";
  if (material === "rail" && a[1] !== b[1]) return "rail-not-horizontal";
  if (wouldLinkArmTower(structure, site.anchors, a, b))
    return "links-arm-tower";
  const next: Structure = {
    ...structure,
    members: [...structure.members, { id: -1, a, b, material }],
  };
  if (cost(next) > site.budget) return "over-budget";
  return null;
}

/** The ring placement rules, in the order `specs/structure.md` lists them. */
export function checkRingPlacement(
  site: SimSite,
  structure: Structure,
  corner: Vec3,
): EditRefusal | null {
  if (structure.ring) return "ring-exists";
  if (!onLattice(corner)) return "off-lattice";
  const placed: Structure = { ...structure, ring: { corner } };
  const { bottom, top } = flangeNodes(placed.ring);
  for (const f of [...bottom, ...top]) {
    if (!insideEnvelope(site.envelope, f)) return "outside-envelope";
  }
  if (corner[1] === 0) return "ring-on-ground";
  if (linksArmToTower(placed, site.anchors)) return "links-arm-tower";
  if (cost(placed) > site.budget) return "over-budget";
  return null;
}

/** The counterweight placement rules of `specs/structure.md`. */
export function checkCounterweightPlacement(
  site: SimSite,
  structure: Structure,
  node: Vec3,
): EditRefusal | null {
  if (!onLattice(node)) return "off-lattice";
  if (!usedNodes(structure).has(nodeKey(node))) return "node-unused";
  const k = nodeKey(node);
  for (const cw of structure.counterweights) {
    if (nodeKey(cw) === k) return "counterweight-exists";
  }
  const placed: Structure = {
    ...structure,
    counterweights: [...structure.counterweights, node],
  };
  if (cost(placed) > site.budget) return "over-budget";
  return null;
}

/** An empty crane, which is what opening a site with nothing built leaves. */
export const emptyStructure = (): Structure => ({
  members: [],
  ring: null,
  counterweights: [],
});
