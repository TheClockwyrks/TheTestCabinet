// Automated validation for the Multi-ball sub-item `respawn-collision`: a ball in
// flight can collide with a ball that is respawning (waiting out its countdown, held
// at its home). The respawning ball is solid but immovable — the live ball rebounds
// off it while the held ball stays put — so respawning does not make a ball pass
// through the others.
//
// Ball 1 is driven out the goal so it respawns and waits, held, at its home; ball 0
// is then fired straight at it. The real ball-to-ball resolution runs as the
// simulation steps: the live ball must rebound without the two ever overlapping, and
// the respawning ball must not move.

import { clearPaddles, stepUntil } from "../_helpers.mjs";

const TWO_RADII = 22; // BALL_COLLIDE_DIST — the touch distance of two balls

export default async function drive(api, ttc) {
  const check = ttc.checkOne("multi-ball.respawn-collision");

  await api.reset({ seed: 11 });
  await api.call("startMatch", "versus");
  await api.call("serve");
  await api.call("setScore", 0, 0);
  await clearPaddles(api);

  // Park balls 0 and 2 out of the way, then drive ball 1 out the right goal so it
  // respawns and waits, held, at its home on the centerline.
  await api.call("setBall", 2, { x: 40, y: 40, vx: 0, vy: 0, spin: 0 });
  await api.call("setBall", 0, { x: 40, y: 690, vx: 0, vy: 0, spin: 0 });
  await api.call("setBall", 1, { x: 1150, y: 360, vx: 900, vy: 0, spin: 0 });

  const respawned = await stepUntil(api, (s) => s.balls[1].held, 1.5, 0.02);
  check.expectOk(
    "ball 1 leaves the field and respawns, waiting held at its home",
    respawned.snap.balls[1].held,
  );
  const home = respawned.snap.balls[1];

  // Fire ball 0 straight at the held, respawning ball 1.
  await api.call("setBall", 0, { x: 500, y: home.y, vx: 420, vy: 0, spin: 0 });

  // Step in small increments, tracking the closest the two centers come and the
  // moment ball 0 rebounds off the held ball.
  let minGap = Infinity;
  let after = null;
  for (let i = 0; i < 120; i += 1) {
    await api.step(0.01);
    const s = await api.snapshot();
    const b0 = s.balls[0];
    const b1 = s.balls[1];
    const gap = Math.hypot(b1.x - b0.x, b1.y - b0.y);
    if (gap < minGap) minGap = gap;
    if (b0.vx < 0) {
      after = s.balls;
      break;
    }
  }

  check.expectOk(
    "the in-flight ball collides with the respawning ball and rebounds",
    after !== null,
  );
  check.expectLt(
    "the in-flight ball reverses off the respawning ball (vx)",
    after ? after[0].vx : 0,
    0,
  );
  check.expectOk(
    "the respawning ball stays held — it is solid but immovable",
    after !== null && after[1].held,
  );
  check.expectClose(
    "the respawning ball did not move (x)",
    after ? after[1].x : 0,
    home.x,
    2,
  );
  check.expectClose(
    "the respawning ball did not move (y)",
    after ? after[1].y : 0,
    home.y,
    2,
  );
  check.expectGe(
    "the balls never overlap or pass through each other (closest center gap)",
    minGap,
    TWO_RADII - 1,
  );

  // A clip: a live ball glancing off the held, respawning ball.
  await api.wait(1400);

  return check.verdict();
}
