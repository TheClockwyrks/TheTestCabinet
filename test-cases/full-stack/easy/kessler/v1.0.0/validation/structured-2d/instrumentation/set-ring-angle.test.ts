// instrumentation/set-ring-angle — the pose lands normalized, the targets ride
// it, the speed does not move.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words `setRingAngle`
// as "sets ring `ring`'s angle to `deg`, normalized into `[0, 360)`. Every
// target on the ring moves with it, and the ring's speed is untouched."
//
// THREE READS DECIDE IT. The snapshot decides the set-and-normalize half: a
// pose of `-90` reads back as `270`, and a pose of `450` as `90`. The speed
// read decides the last clause — ring 2 keeps the wave-1 `+12` degrees per
// second it stood at. And "every target moves with it" is decided by a ball:
// after the pose, a target's arc is wherever the NEW angle puts it, so a ball
// driven outward through the arc center computed under the posed angle scores
// the face hit of specs/rings.md. The witness target is a two-hit-point ring 2
// one, so the hit destroys nothing and drags no other system in.
//
// Ring 2's orbit drifts the arc about `0.2` degrees a tick — three ticks of
// run-up against an `18.5`-degree arc, so the drift decides nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import { ringSpec } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  slotArcCenterDeg,
  type Harness,
} from "../harness";

/** The pose under test: `-90` must land as `270`. */
const POSED_DEG = -90;
const NORMALIZED_DEG = 270;

/** The slot holding the witness target, and its hit points. */
const SLOT = 7;
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

it("normalizes the posed angle, keeps the speed, and moves the targets", async () => {
  isolate(h);
  h.debug.spawnTarget(2, SLOT, HP);

  h.debug.setRingAngle(2, POSED_DEG);
  const posed = h.snapshot();
  assertCloseTo(
    posed.rings[1].angleDeg,
    NORMALIZED_DEG,
    6,
    "ring 2's angle after posing -90",
  );
  assertCloseTo(
    posed.rings[1].speedDegPerSec,
    ringSpec(2).orbitSpeedAtWave(1),
    6,
    "ring 2's speed after the pose",
  );

  h.debug.setRingAngle(1, 450);
  assertCloseTo(
    h.snapshot().rings[0].angleDeg,
    90,
    6,
    "ring 1's angle after posing 450",
  );

  // The target rode the pose: its arc is where the NEW angle puts it.
  const theta = slotArcCenterDeg(2, SLOT, NORMALIZED_DEG);
  spawnBallPolar(h, RUNUP_RADIUS, theta, RUNUP_SPEED, 0);
  const run = await captureReplay(h, "ridden", () =>
    h.until((s) => s.rings[1].targets[0]?.hp !== HP, { maxTicks: 8 }),
  );
  assertEqual(run.hit, true, "the ball finding the target under the new angle");
  assertDeepEqual(
    run.snapshot.rings[1].targets,
    [{ slot: SLOT, hp: HP - 1 }],
    "the ridden target after the hit",
  );
});
