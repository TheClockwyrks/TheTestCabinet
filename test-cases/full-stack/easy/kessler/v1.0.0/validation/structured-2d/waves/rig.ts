// waves/rig — the one arrangement this category stages over and over: a strike.
//
// A strike is one hit-point-1 target on ring 1 and one ball flying straight
// out at the target's arc center, so the next face crossing is a destruction
// (specs/rings.md: "a target whose hit points reach zero is destroyed"). Ring 1
// is the stationary ring ("orbit speed at wave `w`" is "`0` (stationary)"), so
// the posed arc stands exactly where the pose left it for however many ticks
// the flight takes, and the aim is pure arithmetic over the slot geometry.

import { ballSpeedAtWave, RING_SPECS } from "../constants";
import {
  slotArcCenterDeg,
  spawnBallPolar,
  type Harness,
  type KesslerSnapshot,
} from "../harness";

/** The live targets across all three rings, the count a clearing takes to 0. */
export function totalTargets(snapshot: KesslerSnapshot): number {
  return snapshot.rings.reduce((sum, ring) => sum + ring.targets.length, 0);
}

/** Every slot of every ring: what a fresh wave lays out (specs/rings.md). */
export const FULL_FIELD = RING_SPECS.reduce((sum, ring) => sum + ring.slots, 0);

/**
 * Where the strike ball starts: safely below ring 1's inner contact radius
 * (282), so the face crossing is a few ticks of clean outward flight away.
 */
const STRIKE_RADIUS = 270;

/**
 * Ticks that generously cover the strike's flight to the contact — the
 * crossing itself lands after (282 - 270) / (240 / 60) = 3 ticks.
 */
export const STRIKE_BUDGET_TICKS = 30;

/**
 * Pose a strike at ring 1's slot `slot`: one full-hit-point (1) target, and
 * one ball at the slot's arc-center angle flying radially outward at the
 * wave-1 ball speed.
 */
export function armStrike(h: Harness, slot: number): void {
  h.debug.spawnTarget(1, slot, 1);
  spawnBallPolar(
    h,
    STRIKE_RADIUS,
    slotArcCenterDeg(1, slot, 0),
    ballSpeedAtWave(1),
    0,
  );
}

/** The ring table re-exported so a suite reads slot counts and hit points beside the rig. */
export { RING_SPECS as RINGS };
