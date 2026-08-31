// Kessler — ring slot and target-arc geometry (specs/rings.md).
//
// Slot `k` of a ring begins at the ring's angle plus `k` times the slot width;
// its target arc begins `2` degrees into the slot and spans the ring's arc
// width, leaving the `2`-degree structural gap at each side. Membership is by
// the querying body's center angle, wrap-aware, boundaries inclusive
// (`specs/field.md`). The queries here take angles relative to the ring —
// a target arc never moves in the ring's own frame — so a caller decides a
// relative crossing by comparing this tick's relative angle against last
// tick's under the same arcs.

import { RINGS, SLOT_GAP_DEG, type RingSpec } from "./constants";
import { withinArcDeg } from "./polar";

/**
 * The center of slot `slot`'s target arc, in degrees relative to the ring's
 * angle.
 */
export function arcCenterRelDeg(spec: RingSpec, slot: number): number {
  return slot * spec.slotWidthDeg + SLOT_GAP_DEG + spec.arcDeg / 2;
}

/**
 * The center of slot `slot`'s target arc on the stage, under ring angle
 * `ringAngleDeg`.
 */
export function arcCenterDeg(
  spec: RingSpec,
  slot: number,
  ringAngleDeg: number,
): number {
  return ringAngleDeg + arcCenterRelDeg(spec, slot);
}

/**
 * Whether a center angle of `relDeg`, relative to the ring's angle, is within
 * slot `slot`'s target arc, boundaries inclusive.
 */
export function withinArcRel(
  spec: RingSpec,
  relDeg: number,
  slot: number,
): boolean {
  return withinArcDeg(relDeg, arcCenterRelDeg(spec, slot), spec.arcDeg / 2);
}

/**
 * One ring's live state: its angle, its current orbit speed, and the hit
 * points each slot's target has left — `null` where the slot holds no target.
 */
export interface RingState {
  angleDeg: number;
  speedDegPerSec: number;
  targets: (number | null)[];
}

/** A freshly laid out ring: every slot filled at full hit points. */
export function filledRing(spec: RingSpec, wave: number): RingState {
  return {
    angleDeg: 0,
    speedDegPerSec: spec.speedForWave(wave),
    targets: Array.from({ length: spec.slots }, () => spec.hitPoints),
  };
}

/**
 * The slot of the live target whose arc contains the relative center angle
 * `relDeg`, or `null` when the angle sits in a structural gap or over an
 * empty slot. Arcs are disjoint, so at most one slot matches.
 */
export function liveTargetAtRel(
  spec: RingSpec,
  ring: RingState,
  relDeg: number,
): number | null {
  for (let slot = 0; slot < spec.slots; slot += 1) {
    if (ring.targets[slot] !== null && withinArcRel(spec, relDeg, slot)) {
      return slot;
    }
  }
  return null;
}

/** How many live targets the three rings hold between them. */
export function liveTargetCount(rings: readonly RingState[]): number {
  let count = 0;
  for (const ring of rings) {
    for (const hp of ring.targets) {
      if (hp !== null) count += 1;
    }
  }
  return count;
}

/** The three rings of wave `wave`, each filled and at ring angle `0`. */
export function filledRings(wave: number): RingState[] {
  return RINGS.map((spec) => filledRing(spec, wave));
}
