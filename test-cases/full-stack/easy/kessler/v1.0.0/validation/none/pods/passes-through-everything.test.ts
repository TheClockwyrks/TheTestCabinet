// pods/passes-through-everything — a falling pod passes through the shield
// ring, every target, and every ball, its fall unchanged by any of them.
//
// specs/pods.md: "In flight it passes through the shield ring, every target,
// and every ball. Its flight ends at a catch or a burn-up." The pod falls the
// whole field on angle 0 — through a posed target arc on each of the three
// rings (each ring frozen and posed so slot 0's arc centers on angle 0), past
// a posed motionless ball at radius 250, and across the shield's contact
// radius with the shield active — and at sampled ticks inside each band its
// radius still reads exactly the 2-units-per-tick fall, its angle unmoved.
// The deflector stays at 90, so the crossing of the catch radius at angle 0
// is outside the span and cannot end the flight early; the flight ends at the
// burn-up, leaving every bystander exactly as posed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  POD_FALL_SPEED,
  RINGS,
  TICK_HZ,
  angularOffset,
  polarOf,
  slotArcCenterDeg,
} from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  spawnPodPolar,
  type Harness,
  type KesslerSnapshot,
} from "../harness";

/** The flight's angle, and where every obstacle is centered. */
const THETA = 0;
/** Off a whole tick of the burn threshold: 461 reaches 77 on tick 192. */
const START_R = 461;
/** Where the motionless bystander ball is posed. */
const BALL_R = 250;
const PER_TICK = POD_FALL_SPEED / TICK_HZ;

/** Sampled ticks: inside ring 3, ring 2, ring 1, at the ball, past the shield contact. */
const CHECKPOINTS = [10, 47, 81, 105, 182];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The pod, still alone in flight at its predicted radius on angle 0. */
function assertInFlight(snap: KesslerSnapshot, ticks: number): void {
  assertLength(snap.pods, 1, `the pod is still in flight at tick ${ticks}`);
  const p = polarOf(snap.pods[0].x, snap.pods[0].y);
  assertCloseTo(
    p.r,
    START_R - PER_TICK * ticks,
    1,
    `the unchanged fall at tick ${ticks}`,
  );
  assertCloseTo(
    angularOffset(THETA, p.theta),
    0,
    1,
    `the angle at tick ${ticks}`,
  );
}

it("falls through shield, targets, and ball unchanged", async () => {
  await isolate(h);
  // A live target arc centered on angle 0 on each ring, each ring frozen.
  for (const ring of [1, 2, 3]) {
    const spec = RINGS[ring - 1];
    await h.debug.setRingSpeed(ring, 0);
    await h.debug.setRingAngle(ring, -slotArcCenterDeg(ring, 0, 0));
    await h.debug.spawnTarget(ring, 0, spec.hp);
  }
  await h.debug.setShield(true);
  await spawnBallPolar(h, BALL_R, THETA, 0, 0);
  await spawnPodPolar(h, "widen", START_R, THETA);
  const posedBall = (await h.snapshot()).balls[0];

  await captureReplay(h, "through-flight", async () => {
    let elapsed = 0;
    for (const ticks of CHECKPOINTS) {
      const snap = await h.tick(ticks - elapsed);
      elapsed = ticks;
      assertInFlight(snap, ticks);
    }
    const swept = await h.until((s) => s.pods.length === 0, { maxTicks: 30 });
    assertTrue(swept.hit, "the flight ends at the burn-up, nowhere else");

    // Every bystander stands exactly as posed: nothing was hit on the way.
    const end = swept.snapshot;
    assertTrue(end.effects.shieldActive, "the shield ring was passed through");
    for (const ring of [1, 2, 3]) {
      assertLength(
        end.rings[ring - 1].targets,
        1,
        `ring ${ring}'s target was passed through`,
      );
      assertEqual(
        end.rings[ring - 1].targets[0].hp,
        RINGS[ring - 1].hp,
        `ring ${ring}'s target took no hit`,
      );
    }
    assertLength(end.balls, 1, "the bystander ball is untouched");
    assertCloseTo(end.balls[0].x, posedBall.x, 1, "the ball never moved (x)");
    assertCloseTo(end.balls[0].y, posedBall.y, 1, "the ball never moved (y)");
  });
});
