// Automated validation for the Gameplay sub-item `countdown-frozen`.
//
// While the game is paused the pre-serve countdown must not advance: it freezes and
// resumes where it left off. A match is started with injected keys (opening on the
// countdown), advanced partway, then paused; a long stretch of time is then let pass.
// If the countdown kept running while paused it would elapse and the ball would serve
// — so the game must stay paused with the ball still held at center, and resume back
// into the countdown rather than a live rally. See validation/_helpers.mjs.

import { startWithKeys, resumeWithKeys, ball0 } from "../_helpers.mjs";

// How long the game is held paused. The pre-serve hold is ~120 ticks and 24 of them
// have already run when the pause lands, so 318 ticks is over three times what the
// countdown had left: one that kept running behind the pause menu would have elapsed,
// served, and be well into a rally by the end of it. Nothing is sharper about a longer
// hold — it only adds to the clip, where this stretch is 2.6 s of a reviewer watching
// a frozen number.
const PAUSED_TICKS = 318;

export default function item() {
  let mid;
  let pausedScreen;
  let whilePaused;
  let resumedScreen;
  let midResume;
  let resumed;

  return {
    id: "gameplay.countdown-frozen",

    // Navigate the title menu with injected keys, which leaves the match on its
    // pre-serve countdown. Everything after that is timed, so it belongs in `act`.
    async arrange(api) {
      await startWithKeys(api, "solo");
    },

    // The whole freeze/resume sequence, in order: partway into the countdown, pause,
    // let far more than the hold pass, resume, and let the remainder run out. That
    // sequence IS the clip — a reviewer watching it sees the countdown stop dead and
    // then pick up exactly where it left off. Every reading is captured here and
    // asserted afterwards, so neither pass ever branches on a verdict.
    async act(api) {
      // Advance partway into the countdown.
      await api.advance(24); // 24 ticks = the old 0.2s
      mid = await api.snapshot();

      // Pause, then let the paused stretch run. It is simulation time while the verdict
      // is decided and wall-clock time while the clip records, so the same number
      // proves the freeze to the check and demonstrates it to a reviewer.
      await api.call("press", "Escape");
      pausedScreen = (await api.snapshot()).screen;
      await api.advance(PAUSED_TICKS);

      whilePaused = await api.snapshot();

      // Resuming returns to the countdown (it did not skip ahead to a live serve).
      await resumeWithKeys(api);
      resumedScreen = (await api.snapshot()).screen;

      // The resumed countdown is live, not stuck for good, and picks up where it
      // stopped rather than starting over. 24 ticks of the ~120-tick hold ran before
      // the pause, so ~96 of it are left, and two readings bracket that: still counting
      // down 84 ticks in, served by 108. A build that restarted the hold is still
      // counting at 108 (it owes a fresh ~120), and one that dropped the remainder and
      // launched on the resume itself is already playing at 84. The countdown length
      // itself is pinned to 120 +/- 3 ticks by `gameplay.countdown-length`, so both
      // readings sit 9 ticks clear of a conformant build either way.
      //
      // These are reads taken inside the same stretch that always ran, not a shorter
      // one: the clip still plays the whole resumed countdown out and on into the
      // rally.
      await api.advance(84);
      midResume = await api.snapshot();
      await api.advance(24); // 108 ticks in — past the ~96 left, short of a fresh ~120
      resumed = await api.snapshot();

      // A tail on the now-live rally, so the clip ends on the ball actually moving
      // rather than on the frame it launched.
      await api.advance(84); // out to the 192 ticks the resumed stretch always filmed
    },

    async assert(api, check) {
      check.expectEq("still counting down partway in", mid.screen, "countdown");

      check.expectEq("the game is paused", pausedScreen, "paused");

      check.expectEq(
        "stepping while paused leaves the game paused — the countdown did not run",
        whilePaused.screen,
        "paused",
      );
      check.expectClose(
        "the held ball did not move while paused (x)",
        ball0(whilePaused).x,
        ball0(mid).x,
        1,
      );
      check.expectClose(
        "the held ball did not move while paused (y)",
        ball0(whilePaused).y,
        ball0(mid).y,
        1,
      );

      check.expectEq(
        "resuming returns to the countdown, not a live rally",
        resumedScreen,
        "countdown",
      );

      check.expectEq(
        "the resumed countdown still has its remainder to run, 84 ticks in",
        midResume.screen,
        "countdown",
      );

      check.expectEq(
        "the resumed countdown runs out where it left off and the ball serves",
        resumed.screen,
        "playing",
      );
      check.expectOk(
        "the served ball is moving once the resumed countdown elapses",
        Math.hypot(ball0(resumed).vx, ball0(resumed).vy) > 1,
      );
    },
  };
}
