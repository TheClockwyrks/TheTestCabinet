// Automated validation for the Gameplay sub-item `countdown-frozen`.
//
// While the game is paused the pre-serve countdown must not advance: it freezes and
// resumes where it left off. A match is started with injected keys (opening on the
// countdown), advanced partway, then paused; a long stretch of both simulation and
// real time is then let pass. If the countdown kept running while paused it would
// elapse and the ball would serve — so the game must stay paused with the ball still
// held at center, and resume back into the countdown rather than a live rally. See
// validation/_helpers.mjs.

import { startWithKeys } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.countdown-frozen");

  // Open on the countdown and advance partway into it.
  await startWithKeys(api, "solo");
  await api.step(0.2);
  const mid = await api.snapshot();
  check.expectEq("still counting down partway in", mid.screen, "countdown");
  const ballBefore = mid.balls[0];

  // Pause, then let far more than the ~1 s hold pass in both simulation and real
  // time. A frozen countdown means nothing advances.
  await api.call("press", "Escape");
  check.expectEq("the game is paused", (await api.snapshot()).screen, "paused");
  await api.step(5); // far longer than the pre-serve hold
  await api.wait(300);

  const whilePaused = await api.snapshot();
  check.expectEq(
    "stepping while paused leaves the game paused — the countdown did not run",
    whilePaused.screen,
    "paused",
  );
  check.expectClose(
    "the held ball did not move while paused (x)",
    whilePaused.balls[0].x,
    ballBefore.x,
    1,
  );
  check.expectClose(
    "the held ball did not move while paused (y)",
    whilePaused.balls[0].y,
    ballBefore.y,
    1,
  );

  // Resuming returns to the countdown (it did not skip ahead to a live serve).
  await api.call("press", "Escape");
  check.expectEq(
    "resuming returns to the countdown, not a live rally",
    (await api.snapshot()).screen,
    "countdown",
  );

  // The resumed countdown is live, not stuck for good: let the remaining hold run
  // out and confirm the ball actually serves. A frozen countdown that resumes but
  // never launches — the ball left sitting at center — is caught here, where the
  // screen check above (which only sees that the countdown came back) would miss it.
  await api.step(1.2); // past the remainder of the ~1 s hold
  const resumed = await api.snapshot();
  check.expectEq(
    "the resumed countdown runs out and the ball serves",
    resumed.screen,
    "playing",
  );
  check.expectOk(
    "the served ball is moving once the resumed countdown elapses",
    Math.hypot(resumed.balls[0].vx, resumed.balls[0].vy) > 1,
  );

  await api.wait(400);

  return check.verdict();
}
