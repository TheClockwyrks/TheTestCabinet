// Automated validation for the Gyre sub-item `oriented-bounce`: the ball bounces off
// the obstacles' tilted faces at oriented angles that track each obstacle's current
// orientation, rather than axis-aligned reflections.
//
// setObstacleClock poses the obstacles at a chosen orientation and holds them there
// (see specs/instrumentation.md). The same purely-horizontal shot is fired at
// obstacle A's center twice: once upright, where a vertical face sends it straight
// back (no vertical deflection); and once tilted ~45deg, where the oriented face
// deflects it well off-axis. The contrast proves the bounce follows the face's tilt.

import { stepUntil } from "../_helpers.mjs";

// Fire a purely-horizontal shot at obstacle A's current center and return the ball's
// outgoing vertical velocity once it bounces. The bounce is detected when the ball's
// velocity turns away from its purely-horizontal launch — either the horizontal
// component drops sharply (an upright face reverses it) or a vertical component
// appears (a tilted face deflects it off-axis). One predicate covers both cases.
async function shootHorizontalAtObstacleA(api) {
  const obs = (await api.snapshot()).obstacles[0];
  await api.call("setBall", 0, {
    x: obs.cx - 220,
    y: obs.cy,
    vx: 520,
    vy: 0,
    spin: 0,
  });
  const r = await stepUntil(
    api,
    (s) => s.balls[0].vx < 300 || Math.abs(s.balls[0].vy) > 80,
    0.8,
  );
  return { obs, hit: r.hit, outVy: r.snap.balls[0].vy };
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gyre.oriented-bounce");

  // Upright control: obstacle clock at 0 holds obstacle A upright, presenting a
  // vertical face — the horizontal shot returns straight (no vertical deflection).
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
  await api.call("setObstacleClock", 0);
  const upright = await shootHorizontalAtObstacleA(api);
  check.expectOk("the upright obstacle is struck", upright.hit);
  check.expectClose(
    "an upright obstacle reflects a horizontal shot straight back (vy)",
    upright.outVy,
    0,
    40,
  );

  // Tilted: clock at 0.75 s rotates the obstacle ~45deg — the oriented face deflects
  // the same horizontal shot well off-axis (a large vertical component appears).
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
  await api.call("setObstacleClock", 0.75);
  const tilted = await shootHorizontalAtObstacleA(api);
  const tiltDeg = ((Math.abs(tilted.obs.theta) * 180) / Math.PI) % 90;
  check.expectGt("the obstacle is clearly tilted off-axis (deg)", tiltDeg, 20);
  check.expectLt("the obstacle is not axis-aligned (deg)", tiltDeg, 70);
  check.expectOk("the tilted obstacle is struck", tilted.hit);
  check.expectGt(
    "a tilted obstacle deflects the same horizontal shot off-axis, tracking its orientation (vy)",
    Math.abs(tilted.outVy),
    120,
  );

  // A clip: a shot glancing off a visibly tilted obstacle at an oriented angle.
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
  await api.call("setObstacleClock", 0.75);
  const obs = (await api.snapshot()).obstacles[0];
  await api.call("setBall", 0, {
    x: obs.cx - 260,
    y: obs.cy - 20,
    vx: 480,
    vy: 0,
    spin: 0,
  });
  await api.call("setAutoStep", true); // hand the clock back so the clip animates
  await api.wait(1500);

  return check.verdict();
}
