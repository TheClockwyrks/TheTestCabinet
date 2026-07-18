// Automated validation for the Ball sub-item `obstacle-no-speedup`: bouncing off a
// mid-field obstacle does not speed the ball up. Only a paddle hit multiplies the
// ball's speed; a wall or obstacle bounce preserves it (specs/physics.md).
//
// A ball is fired straight at obstacle A's left face at a known speed; the incoming
// and outgoing speeds are read off the real collision. The outgoing speed must match
// the incoming one — the obstacle reflects the ball without accelerating it.

import { clearPaddles, startPlaying, stepUntil } from "../_helpers.mjs";

const OBSTACLE_A = { faceX: 480, y: 220 };

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ball.obstacle-no-speedup");

  await startPlaying(api);
  await clearPaddles(api);
  const speed = 600;
  await api.call("setBall", 0, {
    x: OBSTACLE_A.faceX - 180,
    y: OBSTACLE_A.y,
    vx: speed,
    vy: 0,
    spin: 0,
  });
  const before = (await api.snapshot()).balls[0].speed;

  // Step until the ball reflects off the obstacle (vx reverses), then read its speed.
  const r = await stepUntil(api, (s) => s.balls[0].vx < 0, 2);
  const after = r.snap.balls[0].speed;

  check.expectOk("the ball rebounds off obstacle A (vx reverses)", r.hit);
  check.expectClose(
    "an obstacle bounce leaves the ball's speed unchanged (px/s)",
    after,
    before,
    2,
  );

  // A clip: a bank shot glancing off an obstacle at a steady speed.
  await startPlaying(api);
  await clearPaddles(api);
  await api.call("setBall", 0, { x: 300, y: 220, vx: 560, vy: 0, spin: 0 });
  await api.wait(1400);

  return check.verdict();
}
