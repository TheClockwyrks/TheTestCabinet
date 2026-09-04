// pods/draw — the one destruction every pod-draw item stages.
//
// specs/pods.md: "Each destruction runs the draw at the moment it resolves",
// and specs/rings.md: "a target whose hit points reach zero is destroyed".
// This helper is the stager, not the judge: it poses one target with one hit
// point on a ring it has frozen, fires one posed ball straight at the target's
// arc center, sweeps to the destruction, and clears the ball away — so what a
// caller reads off the destruction tick's snapshot is the draw's work alone.
// A build that cannot resolve the posed destruction fails here by assertion,
// which is the verdict the item owes (a validator always ends pass or fail).

import { assertTrue } from "../assert";
import { RING_SPECS } from "../constants";
import {
  spawnBallPolar,
  slotArcCenterDeg,
  type Harness,
  type KesslerSnapshot,
} from "../harness";

/**
 * Where the draw items park the deflector: far from every ring-1 slot the
 * destructions below use (arc centers 15..165 under ring angle 0), so a shed
 * pod cannot brush the catch radius while a later destruction is staged.
 */
export const AWAY_ANGLE = 270;

/**
 * Margin outside the ring's outer contact radius the ball is posed at: 1.5
 * ticks of flight at the posed 240 units/second, so the crossing lands 2 whole
 * units clear of the contact boundary rather than exactly on it.
 */
const APPROACH_MARGIN = 6;

/**
 * Freeze ring `ring` at `ringAngleDeg`, pose a one-hit-point target in `slot`,
 * and destroy it with a posed ball fired straight at the arc center. Returns
 * the destruction tick's own snapshot (the sweep stops the tick the target
 * dies), with the ball already cleared away.
 */
export async function destroyPosedTarget(
  h: Harness,
  ring: number,
  slot: number,
  ringAngleDeg = 0,
): Promise<KesslerSnapshot> {
  const spec = RING_SPECS[ring - 1];
  h.debug.setRingSpeed(ring, 0);
  h.debug.setRingAngle(ring, ringAngleDeg);
  h.debug.spawnTarget(ring, slot, 1);
  const theta = slotArcCenterDeg(ring, slot, ringAngleDeg);
  spawnBallPolar(h, spec.outerContactRadius + APPROACH_MARGIN, theta, -240, 0);
  const swept = await h.until(
    (s) => !s.rings[ring - 1].targets.some((t) => t.slot === slot),
    { maxTicks: 12 },
  );
  assertTrue(
    swept.hit,
    `the posed ring ${ring} slot ${slot} target is destroyed within 12 ticks`,
  );
  h.debug.clearBalls();
  return swept.snapshot;
}

/**
 * Resolve one draw on ring 1 (stationary, ring angle 0) and read what it shed:
 * the shed pod's kind, or `null` for a destruction that shed nothing. Clears
 * the pod away afterwards, so successive draws each read their own shed.
 * Callers keep the field free of other pods.
 */
export async function shedOf(h: Harness, slot: number): Promise<string | null> {
  const after = await destroyPosedTarget(h, 1, slot, 0);
  const kind =
    after.pods.length > 0 ? after.pods[after.pods.length - 1].kind : null;
  h.debug.clearPods();
  return kind;
}
