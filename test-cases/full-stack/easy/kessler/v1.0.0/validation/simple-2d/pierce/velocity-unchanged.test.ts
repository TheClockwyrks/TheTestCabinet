// pierce/velocity-unchanged — a piercing ball's target contact leaves its
// velocity untouched: no reflection, no ring kick, no orbital decay.
//
// specs/pods.md, "pierce": a piercing ball's target contact "leaves the
// ball's velocity unchanged: no reflection, no ring kick, no orbital decay",
// so the ball "carries on through the ring on its straight line". The ring is
// deliberately LEFT ORBITING at its wave-1 speed (+12 degrees per second,
// specs/rings.md) so that a wrongly-applied ring kick — 0.5x a surface speed
// of ~74 units per second at the contact radius — shows up as a ~37 unit/s
// tangential change, and a wrongly-applied reflection or decay is larger
// still. A conformant build does not touch the vector at all, so the check
// compares both components to the posed figures with float-level slack.
//
// THE WORLD IS ONE TARGET AND ONE BALL, per isolate(). The contact resolves
// on tick 3 (radii 345, 349, 353 across contact radius 352), by when the ring
// has advanced 0.6 degrees — the ball is aimed at the arc center AS POSED ON
// THAT TICK, comfortably inside the 18.5-degree arc throughout.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  outboundBall,
  PIERCE_DURATION,
  poseIsolated,
  poseRingTwoTarget,
  soleBall,
} from "./stage";

/** The ring 2 slot the target is posed in. */
const SLOT = 3;
/** Ring 2's wave-1 orbit (specs/rings.md: min(12 + 3(w-1), 45) at w = 1). */
const RING_TWO_WAVE_ONE_DEG_PER_SEC = 12;
/** The contact resolves on this tick of the drive. */
const CONTACT_TICK = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the ball straight through the contact, velocity untouched", async () => {
  await poseIsolated(h);
  await armPierce(h, PIERCE_DURATION);
  const arcDeg = await poseRingTwoTarget(h, SLOT, { hp: 2 });
  // Aim where the orbit will have carried the arc's center by the contact tick.
  const aimDeg = arcDeg + (RING_TWO_WAVE_ONE_DEG_PER_SEC * CONTACT_TICK) / 60;
  const posed = await outboundBall(h, aimDeg, 341);

  const after = await captureReplay(h, "through", async () => {
    const contacted = await h.tick(CONTACT_TICK + 1);
    await h.tick(4); // let the replay show the straight line continuing
    return contacted;
  });

  const ball = soleBall(after);
  assertCloseTo(ball.vx, posed.vx, 2, "vx through the piercing contact");
  assertCloseTo(ball.vy, posed.vy, 2, "vy through the piercing contact");
});
