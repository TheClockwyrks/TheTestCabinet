// Automated validation for the Multi-ball sub-item `still-not-launched`: a ball is
// launched only out of its pre-serve countdown, never because it happens to be
// sitting still.
//
// Two balls can cancel each other out mid-rally and settle to a near-standstill —
// a state normal play reaches — and the simulation must leave such a ball where it
// is rather than teleport it back to serve speed. A ball at rest but LIVE (not held
// for a countdown) is posed, then both the real step loop and a re-serve are run
// against it: it must stay at rest through both, while a genuinely held ball (the
// pre-serve countdown) still launches as it should.

import { clearPaddles } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("multi-ball.still-not-launched");

  await api.reset({ seed: 7 });
  await api.call("startMatch", "versus");
  await clearPaddles(api);

  // Positive control: serving launches balls that ARE waiting in their pre-serve
  // hold, so a build that simply never launches anything cannot pass by doing nothing.
  await api.call("serve");
  const launched = (await api.snapshot()).balls[0];
  check.expectGt(
    "serving launches a ball waiting in its countdown (speed)",
    launched.speed,
    100,
  );

  // Park the other two out of the way, then pose ball 0 dead still in LIVE play (not
  // held) — the near-standstill two balls settle into when they cancel out.
  await api.call("setBall", 1, { x: 30, y: 30, vx: 0, vy: 0, spin: 0 });
  await api.call("setBall", 2, { x: 1250, y: 30, vx: 0, vy: 0, spin: 0 });
  await api.call("setBall", 0, { x: 640, y: 360, vx: 0, vy: 0, spin: 0 });
  const posed = (await api.snapshot()).balls[0];
  check.expectOk("the posed ball is live, not held", posed.held === false);
  check.expectLt("the posed ball starts at rest (speed)", posed.speed, 1);

  // Running the real sim does not launch a still, live ball: with zero velocity and
  // no spin it only advances by its (zero) velocity, so it stays put. This is the
  // path a stalled ball actually takes in a rally.
  await api.step(1.5);
  const stepped = (await api.snapshot()).balls[0];
  check.expectLt(
    "a still, live ball stays at rest while the sim runs (not launched)",
    stepped.speed,
    1,
  );
  check.expectOk(
    "a still, live ball is not turned into a held / counting-down ball",
    stepped.held === false,
  );

  // Re-serving launches balls in the pre-serve hold, not a ball merely at rest: a
  // still, live ball has no countdown to end, so a serve must leave it alone.
  await api.call("serve");
  const served = (await api.snapshot()).balls[0];
  check.expectLt(
    "re-serving leaves a still, live ball at rest (only a held ball serves)",
    served.speed,
    1,
  );

  // A clip: ball 0 sitting still, unlaunched, under a running sim. Hand the clock
  // back to the animation loop so the sim actually runs and the still ball is seen to
  // stay put rather than the whole field being frozen.
  await api.call("setAutoStep", true);
  await api.wait(1500);

  return check.verdict();
}
