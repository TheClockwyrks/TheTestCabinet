// Automated validation for the Gyre sub-item `obstacles-spin`: the obstacles spin —
// each rotates about its own center as the obstacle clock advances.
//
// setObstacleClock poses the obstacles at a chosen clock time and holds them there
// (see specs/instrumentation.md), so the check reads each obstacle's rotation back at
// three clock times. Each obstacle is upright (theta ~ 0) at clock 0, is clearly
// rotated part-way through, and keeps rotating further as the clock advances.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gyre.obstacles-spin");

  await api.reset();
  await api.call("startMatch", "versus"); // obstacle clock at 0, held while driven
  await api.call("setObstacleClock", 0);
  const at0 = (await api.snapshot()).obstacles;
  await api.call("setObstacleClock", 0.5);
  const atHalf = (await api.snapshot()).obstacles;
  await api.call("setObstacleClock", 1.0);
  const atOne = (await api.snapshot()).obstacles;

  check.expectClose(
    "obstacle A is upright at clock 0 (theta, rad)",
    Math.abs(at0[0].theta),
    0,
    0.02,
  );
  check.expectGt(
    "obstacle A has rotated part-way through (|theta|, rad)",
    Math.abs(atHalf[0].theta),
    0.3,
  );
  check.expectGt(
    "obstacle A keeps rotating as the clock advances (|theta| grows)",
    Math.abs(atOne[0].theta),
    Math.abs(atHalf[0].theta),
  );
  check.expectGt(
    "obstacle B also rotates as the clock advances (|theta|, rad)",
    Math.abs(atOne[1].theta),
    0.3,
  );

  // A clip: the obstacles spinning under the live clock. Start a live match with keys,
  // then hand the clock back to the animation loop so the obstacle clock advances and
  // the obstacles actually rotate in the recorded video.
  await api.reset();
  await api.call("press", "Enter"); // SOLO — a live match
  await api.call("setAutoStep", true); // hand the clock back so the clip animates
  await api.wait(1800);

  return check.verdict();
}
