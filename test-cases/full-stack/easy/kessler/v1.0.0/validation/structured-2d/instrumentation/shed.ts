// instrumentation/shed — the shared destruction rig the switch and generator
// points stage their "ball-caused destruction" with.
//
// Several instrumentation points need a destruction to happen and then read what
// FOLLOWED it — whether the clearing event fired, whether the pod draw ran —
// rather than anything about the destruction itself. This rig produces exactly
// one such destruction on ring 1, the stationary ring at wave 1
// (specs/rings.md: ring 1's orbit speed is `0`), so the posed target arc stands
// still and a ball driven radially outward through its arc center scores the
// face hit specs/rings.md fixes: "in a tick where the ball's center radius
// crosses a ring's contact radius toward the ring, from below the inner contact
// radius to on or above it ... the ball scores a face hit". Ring 1 targets hold
// one hit point, so the hit destroys.
//
// The rig aims at the arc center under the ring's CURRENT angle and clears
// nothing itself: what the destruction is allowed to trigger is exactly what the
// calling point posed the switches to.

import { assertEqual, fail } from "../assert";
import {
  spawnBallPolar,
  slotArcCenterDeg,
  type Harness,
  type KesslerSnapshot,
} from "../harness";

/**
 * Where the ball starts: inside ring 1's contact annulus (contact inner `282`,
 * specs/field.md), far enough below it that no crossing resolves on the spawn
 * tick itself.
 */
const RUNUP_RADIUS = 270;

/** Outward, `5` units a tick — the inner contact radius is crossed within 3. */
const RUNUP_SPEED = 300;

/** Ticks the crossing is given before the rig calls the scenario broken. */
const MAX_TICKS = 8;

/** Whether ring 1 still holds a live target in slot `slot`. */
export function holdsSlot(snapshot: KesslerSnapshot, slot: number): boolean {
  return snapshot.rings[0].targets.some((target) => target.slot === slot);
}

/**
 * Place a one-hit-point target in ring 1's slot `slot` and destroy it with a
 * ball, returning the snapshot of the destruction tick. The ball is left in
 * flight (reflected inward); a caller staging a second destruction clears it.
 */
export async function shedDestruction(
  h: Harness,
  slot: number,
): Promise<KesslerSnapshot> {
  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen the rig stages on");
  h.debug.spawnTarget(1, slot, 1);
  const theta = slotArcCenterDeg(1, slot, before.rings[0].angleDeg);
  spawnBallPolar(h, RUNUP_RADIUS, theta, RUNUP_SPEED, 0);

  const run = await h.until((s) => !holdsSlot(s, slot), {
    maxTicks: MAX_TICKS,
  });
  if (!run.hit) {
    return fail(
      "a ball crossing ring 1's inner contact radius through the posed " +
        "target's arc to destroy it (specs/rings.md)",
      `the target still stands after ${MAX_TICKS} ticks`,
    );
  }
  return run.snapshot;
}
