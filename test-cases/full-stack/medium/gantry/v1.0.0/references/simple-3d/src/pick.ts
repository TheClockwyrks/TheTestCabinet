// What a click at the pointer's position would take (`specs/controls.md`).
//
// A node pick considers every lattice node in the envelope standing in front of
// the camera, projected to the stage; a member pick considers every member's
// projected segment. Both are decided in logical stage units, through the one
// projection `src/project.ts` owns, so what is picked is what is drawn.
//
// Everything here is a pure reading of the state: `snapshot.pick` is exactly
// `pick`, and the build tools of `src/editor.ts` turn the same candidates into
// edits.

import {
  LATTICE_PITCH,
  MEMBER_PICK_PX,
  NODE_PICK_PX,
  SITES,
  type Envelope,
} from "./constants";
import type { ReadonlyPoint } from "./convert";
import { copyPoint } from "./convert";
import type { Camera, ReadonlyGantryState, Vec3 } from "./game";
import {
  cameraBasis,
  depthOf,
  distanceBetween,
  project,
  type CameraBasis,
} from "./project";
import { currentStructure } from "./state";

/** What a click at a stage position would take (`specs/controls.md`). */
export interface Pick {
  /** The picked lattice node, or `null` with none in range. */
  node: Vec3 | null;
  /** The picked member's id, or `null` with none in range. */
  member: number | null;
}

/**
 * How far in front of the camera a point must stand to be projected. A point on
 * the camera's own plane has no projection at all, so a segment crossing that
 * plane is cut a hair in front of it.
 */
const NEAR = 1e-6;

/**
 * Two distances this close are one distance, so a tie is decided by the order
 * `specs/controls.md` fixes rather than by the last bit of a float.
 */
const TIE_EPS = 1e-9;

/** `-1`, `0`, or `1`, with distances inside `TIE_EPS` counted equal. */
export const compare = (a: number, b: number): number =>
  Math.abs(a - b) <= TIE_EPS ? 0 : a < b ? -1 : 1;

/** The camera the picking is measured through, built once per pick. */
export const viewBasis = (camera: Camera): CameraBasis => cameraBasis(camera);

// ---- Candidates ------------------------------------------------------------

/** One lattice node in range of the click, with what breaks its ties. */
export interface NodeCandidate {
  readonly node: Vec3;
  /** Stage distance from the click, in logical pixels. */
  readonly dist: number;
  /** Distance from the camera, which is the first tie-break. */
  readonly cam: number;
}

/** One member in range of the click, with what breaks its ties. */
export interface MemberCandidate {
  readonly id: number;
  readonly dist: number;
  /** How far the nearest point on the segment stands from the camera. */
  readonly cam: number;
}

/**
 * A lattice node's candidacy: `null` when it does not stand in front of the
 * camera, which is the whole of what a node pick leaves out
 * (`specs/controls.md`).
 */
function nodeCandidate(
  basis: CameraBasis,
  camera: Camera,
  node: ReadonlyPoint,
  px: number,
  py: number,
): NodeCandidate | null {
  if (!(depthOf(basis, node) > NEAR)) return null;
  const at = project(camera, node);
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  return {
    node: copyPoint(node),
    dist: Math.hypot(at.x - px, at.y - py),
    cam: distanceBetween(node, basis.eye),
  };
}

/** Whether one node candidate beats another, in the order the spec fixes. */
function nodeBeats(a: NodeCandidate, b: NodeCandidate): boolean {
  let c = compare(a.dist, b.dist);
  if (c !== 0) return c < 0;
  c = compare(a.cam, b.cam);
  if (c !== 0) return c < 0;
  c = compare(a.node.x, b.node.x);
  if (c !== 0) return c < 0;
  c = compare(a.node.y, b.node.y);
  if (c !== 0) return c < 0;
  c = compare(a.node.z, b.node.z);
  if (c !== 0) return c < 0;
  return false;
}

/** The better of two node candidates, either of which may be missing. */
function bestNode(
  a: NodeCandidate | null,
  b: NodeCandidate | null,
): NodeCandidate | null {
  if (a === null) return b;
  if (b === null) return a;
  return nodeBeats(b, a) ? b : a;
}

/** The nearest node of a named set within `NODE_PICK_PX`, or none. */
export function nearestOf(
  basis: CameraBasis,
  camera: Camera,
  nodes: readonly ReadonlyPoint[],
  px: number,
  py: number,
): NodeCandidate | null {
  let best: NodeCandidate | null = null;
  for (const node of nodes) {
    const candidate = nodeCandidate(basis, camera, node, px, py);
    if (candidate === null || candidate.dist > NODE_PICK_PX) continue;
    best = bestNode(best, candidate);
  }
  return best;
}

/** The first lattice coordinate at or above a bound. */
const firstNode = (bound: number): number =>
  Math.ceil(bound / LATTICE_PITCH) * LATTICE_PITCH;

/**
 * The node a click takes: every lattice node in the envelope standing in front
 * of the camera, projected to the stage, nearest within `NODE_PICK_PX`
 * (`specs/controls.md`).
 */
export function pickNodeIn(
  basis: CameraBasis,
  camera: Camera,
  envelope: Envelope,
  px: number,
  py: number,
): NodeCandidate | null {
  let best: NodeCandidate | null = null;
  for (
    let x = firstNode(envelope.x.min);
    x <= envelope.x.max;
    x += LATTICE_PITCH
  ) {
    for (
      let y = firstNode(envelope.y.min);
      y <= envelope.y.max;
      y += LATTICE_PITCH
    ) {
      for (
        let z = firstNode(envelope.z.min);
        z <= envelope.z.max;
        z += LATTICE_PITCH
      ) {
        const candidate = nodeCandidate(basis, camera, { x, y, z }, px, py);
        if (candidate === null || candidate.dist > NODE_PICK_PX) continue;
        best = bestNode(best, candidate);
      }
    }
  }
  return best;
}

/** A segment cut back to the part of it that stands in front of the camera. */
interface FrontSegment {
  readonly a: ReadonlyPoint;
  readonly b: ReadonlyPoint;
  readonly depthA: number;
  readonly depthB: number;
}

const lerp = (
  a: ReadonlyPoint,
  b: ReadonlyPoint,
  f: number,
): ReadonlyPoint => ({
  x: a.x + (b.x - a.x) * f,
  y: a.y + (b.y - a.y) * f,
  z: a.z + (b.z - a.z) * f,
});

function clipToFront(
  basis: CameraBasis,
  a: ReadonlyPoint,
  b: ReadonlyPoint,
): FrontSegment | null {
  const depthA = depthOf(basis, a);
  const depthB = depthOf(basis, b);
  if (depthA < NEAR && depthB < NEAR) return null;
  if (depthA < NEAR) {
    const f = (NEAR - depthA) / (depthB - depthA);
    return { a: lerp(a, b, f), b, depthA: NEAR, depthB };
  }
  if (depthB < NEAR) {
    const f = (NEAR - depthB) / (depthA - depthB);
    return { a, b: lerp(b, a, f), depthA, depthB: NEAR };
  }
  return { a, b, depthA, depthB };
}

/**
 * A member's candidacy: its projected segment's distance from the click, and
 * where on the member the nearest point of that segment lies, which is what
 * breaks a tie. The screen parameter is carried back to the segment through the
 * perspective, so the point named is the one drawn under the pointer.
 */
function memberCandidate(
  basis: CameraBasis,
  camera: Camera,
  member: {
    readonly id: number;
    readonly a: ReadonlyPoint;
    readonly b: ReadonlyPoint;
  },
  px: number,
  py: number,
): MemberCandidate | null {
  const front = clipToFront(basis, member.a, member.b);
  if (front === null) return null;
  const pa = project(camera, front.a);
  const pb = project(camera, front.b);
  if (
    !Number.isFinite(pa.x) ||
    !Number.isFinite(pa.y) ||
    !Number.isFinite(pb.x) ||
    !Number.isFinite(pb.y)
  ) {
    return null;
  }
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len2 = dx * dx + dy * dy;
  const raw = len2 === 0 ? 0 : ((px - pa.x) * dx + (py - pa.y) * dy) / len2;
  const s = Math.min(1, Math.max(0, raw));
  const denominator = front.depthB + s * (front.depthA - front.depthB);
  const t = denominator === 0 ? s : (s * front.depthA) / denominator;
  const on = lerp(front.a, front.b, Math.min(1, Math.max(0, t)));
  return {
    id: member.id,
    dist: Math.hypot(pa.x + s * dx - px, pa.y + s * dy - py),
    cam: distanceBetween(on, basis.eye),
  };
}

/** Whether one member candidate beats another (`specs/controls.md`). */
function memberBeats(a: MemberCandidate, b: MemberCandidate): boolean {
  let c = compare(a.dist, b.dist);
  if (c !== 0) return c < 0;
  c = compare(a.cam, b.cam);
  if (c !== 0) return c < 0;
  return a.id < b.id;
}

/** The nearest member's projected segment within `MEMBER_PICK_PX`, or none. */
export function pickMemberIn(
  basis: CameraBasis,
  camera: Camera,
  members: readonly {
    readonly id: number;
    readonly a: ReadonlyPoint;
    readonly b: ReadonlyPoint;
  }[],
  px: number,
  py: number,
): MemberCandidate | null {
  let best: MemberCandidate | null = null;
  for (const member of members) {
    const candidate = memberCandidate(basis, camera, member, px, py);
    if (candidate === null || candidate.dist > MEMBER_PICK_PX) continue;
    if (best === null || memberBeats(candidate, best)) best = candidate;
  }
  return best;
}

/** The open site's build envelope (`specs/sites.md`). */
export const currentEnvelope = (state: ReadonlyGantryState): Envelope =>
  SITES[state.siteIndex].envelope;

/**
 * The node and the member a click at the pointer's current position would take,
 * by the pick radii and the tie-breaks `specs/controls.md` fixes. Both are
 * `null` on every screen but `build`, and wherever nothing is in range. It is
 * a pure reading: `snapshot.pick` is exactly this.
 */
export function pick(state: ReadonlyGantryState): Pick {
  if (state.screen !== "build") return { node: null, member: null };
  const camera: Camera = { ...state.camera };
  const basis = viewBasis(camera);
  const { x, y } = state.pointer;
  const node = pickNodeIn(basis, camera, currentEnvelope(state), x, y);
  const member = pickMemberIn(
    basis,
    camera,
    currentStructure(state).members,
    x,
    y,
  );
  return {
    node: node === null ? null : node.node,
    member: member === null ? null : member.id,
  };
}
