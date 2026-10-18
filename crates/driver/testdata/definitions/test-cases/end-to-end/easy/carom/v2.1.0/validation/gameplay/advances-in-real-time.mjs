// Automated validation for gameplay.advances-in-real-time: during normal play the game runs
// itself. The animation loop drives the fixed tick from the wall clock
// (`specs/instrumentation.md`), so a served ball crosses the court with nothing stepping it.
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a frozen court. The spec puts the manual
// clock behind an `autoStep` flag that `reset` and `step` turn OFF, so a build that calls its own
// `reset` on the boot path ships with the flag off and never advances for a player.
//
// WHY THE MEASUREMENT LIVES IN `arrange`. Catching that means observing the clock the build BOOTS
// with, and the window is narrow: `api.reset` hands the clock back by forcing `setAutoStep(true)`,
// `api.skip` does the same, and the runtime sets the flag explicitly between `arrange` and `act`.
// So everything here is `arrange`, poses with CONTROL OPS ONLY — no reset, no step, no skip — and
// measures real elapsed time with `api.settle`, which is genuinely wall-clock in both passes. Do
// not rewrite this onto a helper that opens with a reset; that would mask the defect it hunts.
//
// WHY STILLS RATHER THAN A CLIP. The record pass turns `autoStep` ON for `act`, so a filmed `act`
// animates even for a build that boots frozen — the video would show the very motion the item says
// is missing. Two stills taken around the settle show it honestly. The record pass opens a fresh
// page, so its `arrange` sees the boot clock too.

// ONE second of real time, not the two the sibling cases use. A serve crosses at ~520 px/s, so a
// two-second window is long enough for the rally to be decided: the point is conceded, the ball is
// held at the centre for the next serve, and the displacement this item measures is erased by the
// reset. A second leaves the ball in open flight, half a court from where it started.
const SETTLE_MS = 1000;
// The floor the clock must clear, in seconds of accumulated simulation time. Half the settle,
// deliberately generous: the claim is that the game advances ITSELF, not that it keeps perfect
// time, and a build that clamps its per-frame delta (ordinary spiral-of-death protection) legally
// loses time to a stall. A build driving its own tick lands near 1.0; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor the ball must travel, in logical px. It moves at ~520 px/s, so even a clock managing a
// fifth of real time carries it 100 px. This is a second, independent witness: it says the
// SIMULATION ran, not merely that a counter ticked up.
const MIN_TRAVEL = 100;
// A beat so the record pass has an `act` to replay; the verdict is already fixed by `arrange`.
const TAIL_TICKS = 120;

/**
 * Mark an unmet precondition — the build answered every debug call correctly, but the scenario
 * did not take, so there is nothing to grade. A plain property rather than a shared class because
 * this file is loaded by path and cannot import the runtime's (see `PRECONDITION_UNMET` in
 * `packages/browser-driver/validation.mjs`).
 */
function unmetPrecondition(reason) {
  const err = new Error(reason);
  err.ttcPreconditionUnmet = true;
  return err;
}

/** The ball in play, whichever shape this variant reports (a lone `ball`, or the first of `balls`). */
function liveBall(s) {
  return (Array.isArray(s.balls) && s.balls[0]) || s.ball || null;
}

export default function item() {
  let advanced;
  let travelled;

  return {
    id: "gameplay.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header.
      await api.call("startMatch", "solo");
      await api.call("serve"); // end the pre-serve countdown now, so the ball is already in flight

      const before = await api.snapshot();
      const ball0 = liveBall(before);
      if (!ball0) {
        throw unmetPrecondition(
          `no ball is in play after starting a match and serving (screen ${before.screen}), ` +
            `so there is no moving simulation to observe`,
        );
      }
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      const ball1 = liveBall(after);
      advanced = after.simTime - before.simTime;
      travelled = ball1 ? Math.hypot(ball1.x - ball0.x, ball1.y - ball0.y) : 0;
      await api.screenshot("after");
    },

    async act(api) {
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectGt(
        "the simulation clock advanced on the build's own frame loop, with nothing stepping it",
        advanced,
        MIN_ADVANCE,
      );
      check.expectGt(
        "...and the ball actually travelled, so the simulation ran rather than a counter ticking",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
