// Automated validation for the Multi-ball sub-item `ball-collision`: balls collide
// elastically with each other, never passing through or merging.
//
// Two balls are set on a head-on collision course down the y=360 lane (the third is
// parked away); the real ball-to-ball resolution runs as the simulation steps. The
// two must rebound — an equal-mass head-on collision swaps their velocities, so each
// reverses — while never interpenetrating (the center gap stays at least two radii)
// and never crossing past one another.

import { asserter, clearPaddles } from "../_helpers.mjs";

const TWO_RADII = 22; // BALL_COLLIDE_DIST — the touch distance of two balls

export default async function drive(api) {
  const rec = asserter();

  await api.reset({ seed: 2 });
  await api.call("startMatch", "versus");
  await api.call("serve");
  await clearPaddles(api);
  // Park the third ball out of the lane; aim the other two straight at each other.
  await api.call("setBall", 2, { x: 30, y: 30, vx: 0, vy: 0, spin: 0 });
  await api.call("setBall", 0, { x: 520, y: 360, vx: 400, vy: 0, spin: 0 });
  await api.call("setBall", 1, { x: 760, y: 360, vx: -400, vy: 0, spin: 0 });

  // Step in small increments, tracking the closest the two centers ever come and
  // the moment ball 0 reverses (the collision).
  let minGap = Infinity;
  let after = null;
  for (let i = 0; i < 200; i += 1) {
    await api.step(0.01);
    const s = await api.snapshot();
    const [b0, b1] = s.balls;
    const gap = Math.hypot(b1.x - b0.x, b1.y - b0.y);
    if (gap < minGap) minGap = gap;
    if (b0.vx < 0) {
      after = s.balls;
      break;
    }
  }

  rec.check(
    "two balls on a collision course rebound rather than passing through",
    after !== null &&
      after[0].vx < 0 &&
      after[1].vx > 0 &&
      after[0].x < after[1].x,
  );
  rec.check(
    `the balls never overlap or merge (closest center gap ${minGap.toFixed(0)} >= ${TWO_RADII})`,
    minGap >= TWO_RADII - 1,
  );

  // A clip: the two balls meeting head-on and bouncing apart.
  await api.call("setBall", 2, { x: 30, y: 30, vx: 0, vy: 0, spin: 0 });
  await api.call("setBall", 0, { x: 480, y: 360, vx: 360, vy: 0, spin: 0 });
  await api.call("setBall", 1, { x: 800, y: 360, vx: -360, vy: 0, spin: 0 });
  await api.wait(1600);

  return { verdicts: { "multi-ball.ball-collision": rec.assertions } };
}
