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
// WHY THE SCENARIO IS DRIVEN BY KEYS, NOT BY CONTROL OPS. The claim is about NORMAL PLAY, so the
// scenario has to stay inside normal play — and a control op, by definition, leaves it: calling one
// "puts the paddles under the caller's control" instead of the keyboard and the AI
// (`specs/instrumentation.md`). Posing a match with `startMatch`/`serve` and then asking whether
// the game runs itself therefore grades a state no player is ever in, and it makes the verdict
// depend on a guarantee the spec never gives — that a control op leaves the wall clock feeding the
// sim. A build that reads "arranging a scripted scenario" as "hold the clock still until I step it"
// answers that pose with a stationary court and fails, even though it plays perfectly for a person.
// The input operations are the path the spec reserves for exactly this: injected keys flow through
// the same handling the real keyboard feeds, and "unlike the control operations, injecting input
// does not hand paddle control to a driver". So this item presses through the title menu and then
// watches, which is what the review item's own wording describes.
//
// WHY THE MEASUREMENT LIVES IN `arrange`. Catching the frozen-boot defect means observing the clock
// the build BOOTS with, and the window is narrow: `api.reset` hands the clock back by forcing
// `setAutoStep(true)`, `api.skip` does the same, and the runtime sets the flag explicitly between
// `arrange` and `act`. So everything here is `arrange`, drives with INPUT OPS ONLY — no reset, no
// step, no skip, and no control op — and measures real elapsed time with `api.settle`, which is
// genuinely wall-clock in both passes. Do not rewrite this onto a helper that opens with a reset
// (`startWithKeys` does); that would mask the defect it hunts.
//
// WHY STILLS RATHER THAN A CLIP. The record pass turns `autoStep` ON for `act`, so a filmed `act`
// animates even for a build that boots frozen — the video would show the very motion the item says
// is missing. Two stills taken around the flight window show it honestly. The record pass opens a
// fresh page, so its `arrange` sees the boot clock too.

// How long to wait, in ms, for the pre-serve countdown to run itself out and launch a ball. The
// hold is 1.0 s (`specs/balls.md`), so this is generously over it: a build whose countdown is the
// wrong LENGTH is graded by `countdown-length`, and this item only wants a ball in flight to watch.
//
// If the wait expires the measurement runs anyway, against the still-held ball, rather than backing
// out as an unmet precondition. Against a conformant build the wait ALWAYS ends in a launch, so
// expiring means the build is broken, not that the scenario was unconstructible — and the two
// witnesses then say exactly which way it is broken: a build whose clock is dead fails both, and a
// build whose clock counts up while its simulation sits still (a ticking counter, not a running
// game — the very thing the second witness exists for) fails the travel one alone.
const LAUNCH_WAIT_MS = 3000;
// The window the flight is measured over, in ms of real time, sampled in `SLICE_MS` steps. Short
// enough that no point can be scored inside it — a ball crossing at ~520 px/s needs over a second
// to reach a goal from its home point — so nothing resets the ball mid-measurement.
const FLIGHT_MS = 600;
// How finely the real-time waits are sliced. The launch wait polls at this cadence, and the flight
// window is sampled at it, so travel is read as the FURTHEST the ball got from where it launched
// rather than just its end point (see MIN_TRAVEL).
const SLICE_MS = 100;
// The floor the clock must clear over the flight window, in seconds of accumulated simulation time.
// Half the window, deliberately generous: the claim is that the game advances ITSELF, not that it
// keeps perfect time, and a build that clamps its per-frame delta (ordinary spiral-of-death
// protection) legally loses time to a stall. A build driving its own tick lands near FLIGHT_MS; a
// frozen one reports 0.
const MIN_ADVANCE = FLIGHT_MS / 1000 / 2;
// The floor the ball must travel, in logical px, measured as the furthest it got from its launch
// point during the window. It moves at 520 px/s, so even a clock managing a fifth of real time
// carries it 100 px. Peak distance rather than end-to-end displacement because a launch is at a
// random angle in the multi variant: a ball shot straight at the near wall bounces back toward
// where it started, and its net displacement understates a flight that plainly happened. This is a
// second, independent witness: it says the SIMULATION ran, not merely that a counter ticked up.
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

/** Whether a ball has left its pre-serve hold and is actually in flight. */
function inFlight(s) {
  const b = liveBall(s);
  return Boolean(b) && !b.held && Math.hypot(b.vx, b.vy) > 1;
}

export default function item() {
  let advanced;
  let travelled;

  return {
    id: "gameplay.advances-in-real-time",

    async arrange(api) {
      // Input ops only, and never `api.reset` — see the header.
      const boot = await api.snapshot();
      if (boot.screen !== "title") {
        throw unmetPrecondition(
          `the build opened on the ${boot.screen} screen rather than the title menu, so there is ` +
            `no menu entry to confirm into a match without posing one with a control op`,
        );
      }
      // Confirm the highlighted entry (SOLO, the first of the title menu — specs/ui.md), exactly
      // as a player starting a game does.
      await api.call("press", "Enter");

      const started = await api.snapshot();
      if (started.screen !== "countdown" && started.screen !== "playing") {
        throw unmetPrecondition(
          `confirming the title menu left the build on the ${started.screen} screen rather than ` +
            `starting a match, so no rally could be watched (the menu itself is graded by the UI ` +
            `and controls items)`,
        );
      }

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      // First let the build serve itself out of the pre-serve hold.
      let snap = started;
      for (
        let waited = 0;
        waited < LAUNCH_WAIT_MS && !inFlight(snap);
        waited += SLICE_MS
      ) {
        await api.settle(SLICE_MS);
        snap = await api.snapshot();
      }

      // Then watch the flight — or, if the build never launched, whatever it is doing instead. Both
      // witnesses are read over this one window, so the two numbers are always directly comparable
      // to their floors and to each other.
      const start = liveBall(snap);
      const startTime = snap.simTime;
      await api.screenshot("before");

      travelled = 0;
      for (let flown = 0; flown < FLIGHT_MS; flown += SLICE_MS) {
        await api.settle(SLICE_MS);
        snap = await api.snapshot();
        const b = liveBall(snap);
        if (b && start) {
          travelled = Math.max(
            travelled,
            Math.hypot(b.x - start.x, b.y - start.y),
          );
        }
      }
      advanced = snap.simTime - startTime;
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
