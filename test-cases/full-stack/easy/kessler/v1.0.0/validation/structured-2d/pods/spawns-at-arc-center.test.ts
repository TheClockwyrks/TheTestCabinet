// pods/spawns-at-arc-center — a shed pod spawns at its ring's mid radius, at
// the destroyed target's arc-center angle as the ring stands posed.
//
// specs/pods.md: "A shed pod spawns at its ring's mid radius, at the destroyed
// target's arc-center angle as the ring stands posed on the destruction tick",
// with the mid radii tabled 302 / 372 / 442. Read on the destruction tick's
// own snapshot — pods advance before balls resolve (specs/field.md's tick
// order), so the tick that sheds shows the pod exactly where it spawned. Both
// a ring-1 and a ring-3 destruction are posed, each under a NON-ZERO posed
// ring angle, so a build that sheds at the slot's wave-start angle rather than
// the posed one misses by the posed rotation. Position is a spawn point, not a
// contact boundary, so the tolerance is a twentieth of a unit and of a degree.
//
// THE WORLD IS ONE TARGET AND ONE BALL PER DRAW, staged by the shared draw
// helper on a frozen ring with the deflector parked away. Each destruction's
// draw is posed to shed through `setNextPod`, so the pod's spawn point is
// what the check reads rather than whether a draw shed at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength } from "../assert";
import { RING_SPECS } from "../constants";
import {
  angularOffset,
  captureReplay,
  isolate,
  openHarness,
  slotArcCenterDeg,
  xyToPolar,
  type Harness,
} from "../harness";
import { AWAY_ANGLE, destroyPosedTarget } from "./draw";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spawns the shed pod at the mid radius and posed arc center", async () => {
  isolate(h);
  h.debug.setPodSpawn(true);
  h.debug.setPaddleAngle(AWAY_ANGLE);

  // Ring 1, slot 3, posed to ring angle 40: arc center 145, mid radius 302.
  h.debug.setNextPod("widen");
  const ring1 = await captureReplay(h, "spawn-ring1", () =>
    destroyPosedTarget(h, 1, 3, 40),
  );
  assertLength(ring1.pods, 1, "the ring-1 destruction sheds the posed pod");
  const p1 = xyToPolar(ring1.pods[0].x, ring1.pods[0].y);
  assertCloseTo(p1.r, RING_SPECS[0].midRadius, 1, "the ring-1 mid radius");
  assertCloseTo(
    angularOffset(slotArcCenterDeg(1, 3, 40), p1.thetaDeg),
    0,
    1,
    "the destroyed target's arc-center angle under ring angle 40",
  );
  h.debug.clearPods();

  // Ring 3, slot 0, posed to ring angle 200: arc center 209, mid radius 442.
  h.debug.setNextPod("shield");
  const ring3 = await captureReplay(h, "spawn-ring3", () =>
    destroyPosedTarget(h, 3, 0, 200),
  );
  assertLength(ring3.pods, 1, "the ring-3 destruction sheds the posed pod");
  const p3 = xyToPolar(ring3.pods[0].x, ring3.pods[0].y);
  assertCloseTo(p3.r, RING_SPECS[2].midRadius, 1, "the ring-3 mid radius");
  assertCloseTo(
    angularOffset(slotArcCenterDeg(3, 0, 200), p3.thetaDeg),
    0,
    1,
    "the destroyed target's arc-center angle under ring angle 200",
  );
});
