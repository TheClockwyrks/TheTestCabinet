// instrumentation/spawn-target — one call places one target, in its slot, on
// the ring's posed angle.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words `spawnTarget` as
// "places a target with `hp` hit points in slot `slot` of ring `ring`,
// replacing whatever the slot holds", and fixes where the placed target STANDS:
// "the target occupies its slot's arc under the ring's current angle, exactly
// as a wave-start target does".
//
// THREE READS DECIDE IT. The snapshot decides the placement (one target, the
// named slot, the given hit points) and the replacement (posing the slot again
// leaves one entry with the new figure, not two). The arc is decided the way an
// arc means anything — by a ball: with the ring posed at a distinctive angle, a
// ball driven outward through the slot's computed arc center scores the face
// hit specs/rings.md fixes, which is only there to score if the placed target
// occupies the arc its slot and the ring's angle name. The target is a
// two-hit-point ring 2 one, so the witness is a clean hit — no destruction, no
// draw, no clearing anywhere near the point.
//
// Ring 2 orbits at wave 1 (`+12` degrees per second, specs/rings.md), moving
// its arcs about `0.6` degrees over the ball's three-tick run-up — well inside
// the `18.5`-degree arc the ball is aimed at the center of, so the drift
// decides nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  targetArcCenterDeg,
  type Harness,
} from "../harness";

/** The posed ring angle — distinctive, so angle 0 passing is not enough. */
const RING_ANGLE = 200;

/** The slot the target is placed in, and the hit points it is placed with. */
const SLOT = 4;
const HP = 2;

/** The ball: inside ring 2's contact annulus (contact inner 352), outward. */
const RUNUP_RADIUS = 340;
const RUNUP_SPEED = 300;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("places the target in its slot on the ring's current angle", async () => {
  isolate(h);
  h.debug.setRingAngle(2, RING_ANGLE);

  h.debug.spawnTarget(2, SLOT, HP);
  const placed = h.snapshot();
  assertLength(placed.rings[1].targets, 1, "ring 2's targets after the call");
  assertDeepEqual(
    placed.rings[1].targets[0],
    { slot: SLOT, hp: HP },
    "the placed target",
  );

  // Replacing: posing the held slot again leaves one entry, the new figure.
  h.debug.spawnTarget(2, SLOT, 1);
  const replaced = h.snapshot();
  assertDeepEqual(
    replaced.rings[1].targets,
    [{ slot: SLOT, hp: 1 }],
    "the slot's target after posing it again",
  );
  h.debug.spawnTarget(2, SLOT, HP);

  // The arc: a ball through the slot's computed center scores a face hit.
  const theta = targetArcCenterDeg(2, SLOT, RING_ANGLE);
  spawnBallPolar(h, RUNUP_RADIUS, theta, RUNUP_SPEED, 0);
  const run = await captureReplay(h, "occupied", () =>
    h.until((s) => s.rings[1].targets[0]?.hp !== HP, { maxTicks: 8 }),
  );
  assertEqual(run.hit, true, "the ball finding the target on its arc");
  assertDeepEqual(
    run.snapshot.rings[1].targets,
    [{ slot: SLOT, hp: HP - 1 }],
    "the placed target after the hit",
  );
});
