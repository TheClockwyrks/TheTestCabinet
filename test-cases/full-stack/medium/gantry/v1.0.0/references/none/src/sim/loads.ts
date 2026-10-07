// The load model of `specs/statics.md`: mass lumped at nodes, and the force each
// lumped mass applies under the acceleration its node is prescribed.

import {
  COUNTERWEIGHT_MASS,
  GRAVITY,
  RING_MASS,
  TROLLEY_MASS,
} from "../constants";
import { MATERIALS } from "./materials";
import { memberLength } from "./structure";
import type { RailTrack } from "./structure";
import type { Member, Structure, TrolleyPlacement } from "./types";
import {
  add,
  type Axis2,
  crossUp,
  nodeKey,
  rotateAboutY,
  scale,
  sub,
  type Vec3,
} from "./vec";

/** `g = (0, -GRAVITY, 0)`. */
export const GRAVITY_VECTOR: Vec3 = [0, -GRAVITY, 0];

/**
 * The lumped nodal masses: half of every intact member ending at a node, plus
 * `COUNTERWEIGHT_MASS` for a counterweight on it, plus `RING_MASS / 8` for each
 * flange node.
 *
 * A counterweight on a node no intact member ends at and no flange puts there
 * applies nothing: it has fallen with what held it.
 */
export function lumpedMasses(
  structure: Structure,
  intact: readonly Member[],
  flangeKeys: readonly string[],
): Map<string, number> {
  const masses = new Map<string, number>();
  const bump = (k: string, v: number): void => {
    masses.set(k, (masses.get(k) ?? 0) + v);
  };
  const used = new Set<string>(flangeKeys);
  for (const m of intact) {
    used.add(nodeKey(m.a));
    used.add(nodeKey(m.b));
  }
  for (const m of intact) {
    const half = (memberLength(m) * MATERIALS[m.material].massPerUnit) / 2;
    bump(nodeKey(m.a), half);
    bump(nodeKey(m.b), half);
  }
  for (const cw of structure.counterweights) {
    const k = nodeKey(cw);
    if (used.has(k)) bump(k, COUNTERWEIGHT_MASS);
  }
  for (const k of flangeKeys) bump(k, RING_MASS / 8);
  return masses;
}

/**
 * An arm node's prescribed acceleration: `a = -omega^2 r - alpha (k x r)`, with
 * `r` the horizontal vector from the slew axis to the node's ROTATED position.
 * The first term is centripetal and draws the node in; the second is tangential
 * and turns the way a positive slew carries it.
 */
export function nodeAcceleration(
  p: Vec3,
  axis: Axis2,
  omega: number,
  alpha: number,
): Vec3 {
  const r: Vec3 = [p[0] - axis[0], 0, p[2] - axis[1]];
  return sub(scale(r, -omega * omega), scale(crossUp(r), alpha));
}

/**
 * The trolley point's acceleration: the arm's, plus its own motion along the
 * track, `w * u - 2 * omega * (k x u) * v`. The last term is the Coriolis
 * contribution of driving the trolley while the arm turns.
 */
export function trolleyAcceleration(
  p: Vec3,
  axis: Axis2,
  omega: number,
  alpha: number,
  direction: Vec3,
  rate: number,
  accel: number,
): Vec3 {
  return add(
    nodeAcceleration(p, axis, omega, alpha),
    sub(scale(direction, accel), scale(crossUp(direction), 2 * omega * rate)),
  );
}

/** `F = m * g - m * a`, the force a lumped mass applies at its node. */
export const appliedForce = (mass: number, a: Vec3): Vec3 =>
  scale(sub(GRAVITY_VECTOR, a), mass);

/** What the arm's applied-force assembly reads. */
export interface ArmForceInput {
  readonly index: ReadonlyMap<string, number>;
  readonly positions: ReadonlyMap<string, Vec3>;
  readonly masses: ReadonlyMap<string, number>;
  readonly axis: Axis2;
  /** The slew rate and acceleration, in radians. */
  readonly omega: number;
  readonly alpha: number;
  readonly cos: number;
  readonly sin: number;
  readonly track: RailTrack | null;
  readonly trolley: TrolleyPlacement | null;
  readonly trolleyRate: number;
  readonly trolleyAccel: number;
  /** `-T` from `specs/rigging.md`, applied at the trolley point. */
  readonly cableForce: Vec3;
}

/**
 * The arm's applied nodal forces: each lumped mass under its acceleration, and
 * the trolley's own mass and the cable force at the trolley point, shared
 * between the two nodes of the rail member the trolley is on, linearly by its
 * position along that member.
 */
export function assembleArmForces(input: ArmForceInput): Float64Array {
  const f = new Float64Array(3 * input.index.size);
  for (const [k, i] of input.index) {
    const mass = input.masses.get(k) ?? 0;
    const p = input.positions.get(k) as Vec3;
    const force = appliedForce(
      mass,
      nodeAcceleration(p, input.axis, input.omega, input.alpha),
    );
    f[3 * i] += force[0];
    f[3 * i + 1] += force[1];
    f[3 * i + 2] += force[2];
  }
  const { track, trolley } = input;
  if (trolley && track) {
    // The track's rotated origin and rotated unit direction.
    const origin = rotateAboutY(track.origin, input.axis, input.cos, input.sin);
    const tip = rotateAboutY(
      add(track.origin, track.direction),
      input.axis,
      input.cos,
      input.sin,
    );
    const direction = sub(tip, origin);
    const point = add(origin, scale(direction, trolley.t));
    const a = trolleyAcceleration(
      point,
      input.axis,
      input.omega,
      input.alpha,
      direction,
      input.trolleyRate,
      input.trolleyAccel,
    );
    const total = add(appliedForce(TROLLEY_MASS, a), input.cableForce);
    const ia = input.index.get(nodeKey(trolley.nodeA)) as number;
    const ib = input.index.get(nodeKey(trolley.nodeB)) as number;
    const share0 = 1 - trolley.fraction;
    const share1 = trolley.fraction;
    for (let c = 0; c < 3; c++) {
      f[3 * ia + c] += total[c] * share0;
      f[3 * ib + c] += total[c] * share1;
    }
  }
  return f;
}

/**
 * The tower's applied nodal forces: its lumped masses, which stand still and so
 * carry weight alone, plus at each bottom-flange node the negated reaction read
 * at the top-flange node it shares a ring corner with.
 */
export function assembleTowerForces(
  index: ReadonlyMap<string, number>,
  masses: ReadonlyMap<string, number>,
  bottom: readonly Vec3[],
  ringReactions: readonly Vec3[],
): Float64Array {
  const f = new Float64Array(3 * index.size);
  for (const [k, i] of index) {
    const mass = masses.get(k) ?? 0;
    f[3 * i + 1] += -mass * GRAVITY;
  }
  for (let i = 0; i < bottom.length; i++) {
    const bi = index.get(nodeKey(bottom[i]));
    if (bi === undefined) continue;
    f[3 * bi] += -ringReactions[i][0];
    f[3 * bi + 1] += -ringReactions[i][1];
    f[3 * bi + 2] += -ringReactions[i][2];
  }
  return f;
}
