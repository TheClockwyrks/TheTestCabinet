// targets/edge-reflects-tangential — an edge hit on a stationary ring reflects
// the tangential component of the ball's velocity, at arrival speed, then
// decays.
//
// WHAT THE SPECIFICATION FIXES. specs/deflector-and-ball.md's pipeline for a
// target edge hit: "An edge contact reflects the tangential component:
// `v' = v - 2 (v . t) t`", no ring kick (the ring is stationary), "Renormalize
// the speed to the speed the ball arrived with", then "Orbital decay: rotate
// the velocity toward the local radial axis by `min(6, |phi|)` degrees". The
// expected outgoing velocity is that arithmetic applied to the posed arrival
// velocity at the contact position — the position the snapshot reports at the
// hit tick, since "the ball keeps the position its advance gave it this tick".
//
// THE TOLERANCE. The pipeline is exact math; 2 units per second of velocity
// error on a ~243-unit speed (~0.5 degrees) allows float ordering differences
// and nothing that would read as a different rule.
//
// THE WORLD IS THE STATIONARY RING 1'S LONE TARGET AND ONE NEAR-TANGENTIAL
// BALL riding the ring's mid radius into the arc's start edge, its slight
// inward drift keeping the decay's nearer radial unambiguous.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertLessThan, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  arcStartDeg,
  ballAt,
  expectedReflection,
  figures,
  freezeRing,
  placeTarget,
  PROBE_HP,
  PROBE_SPEED,
  targetAt,
} from "./rig";

const RING = 1;
const SLOT = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reflects the tangential component at arrival speed, then decays", async () => {
  await isolate(h);
  await freezeRing(h, RING, 0);
  const fig = figures(RING);
  await placeTarget(h, RING, SLOT, PROBE_HP);
  const midRadius = (fig.innerRadius + fig.outerRadius) / 2;

  const { posed, hit } = await captureReplay(h, "bounce", async () => {
    await ballAt(
      h,
      midRadius,
      arcStartDeg(RING, SLOT, 0) - 1.15,
      -40,
      PROBE_SPEED,
    );
    const posedBall = (await h.snapshot()).balls[0];
    const res = await h.until(
      (s) => {
        const t = targetAt(s, RING, SLOT);
        return t === undefined || t.hp < PROBE_HP;
      },
      { maxTicks: 8 },
    );
    await h.tick(8);
    return { posed: posedBall, hit: res };
  });

  assertTrue(hit.hit, "the angular crossing lands an edge hit");
  const ball = hit.snapshot.balls[0];
  assertDefined(ball, "the ball at the contact tick");
  assertDefined(posed, "the posed ball");
  if (ball === undefined || posed === undefined) return;
  const want = expectedReflection(ball, { vx: posed.vx, vy: posed.vy }, "edge");
  assertLessThan(
    Math.hypot(ball.vx - want.vx, ball.vy - want.vy),
    2,
    "the outgoing velocity: tangential component reflected at arrival speed, " +
      "then rotated toward the radial axis by min(6, |phi|) degrees",
  );
});
