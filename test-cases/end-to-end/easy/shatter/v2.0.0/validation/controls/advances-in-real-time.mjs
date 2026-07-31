// Automated validation for controls.advances-in-real-time: during normal play the game runs
// itself. The animation loop drives the fixed tick from the wall clock
// (`specs/instrumentation.md`), so the field drifts — the rocks travel — with nothing stepping it.
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a frozen field. The spec puts the manual
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
//
// THE WITNESS IS A ROCK, NOT THE SHIP. The ship is the player's and holds its heading unless a key
// is pressed. The rocks drift on their own from the moment the wave spawns, so they are what moves
// when — and only when — the game is running itself. The whole field is measured rather than one
// rock, because a rock that wraps the screen edge inside the window would read as an enormous jump
// and a rock that is destroyed would vanish; the largest displacement across the field is a stable
// reading either way.

// Two seconds of real time, which carries a drifting rock a clear distance across the field.
const SETTLE_MS = 2000;
// Half the settle. Deliberately generous: the claim is that the game advances ITSELF, not that it
// keeps perfect time, and a build that clamps its per-frame delta (ordinary spiral-of-death
// protection) legally loses time to a stall. A running build lands near 2.0; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor the field must show, in logical px of the furthest-travelled rock. A second,
// independent witness: it says the SIMULATION ran, not merely that a counter ticked up.
const MIN_TRAVEL = 20;
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

/** The furthest any rock moved between two readings, comparing by position in the field. */
function furthestDrift(before, after) {
  let furthest = 0;
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i += 1) {
    furthest = Math.max(
      furthest,
      Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y),
    );
  }
  return furthest;
}

export default function item() {
  let advanced;
  let drifted;

  return {
    id: "controls.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header.
      await api.call("startGame"); // enters play and spawns the first wave

      const before = await api.snapshot();
      const rocks0 = before.rocks || [];
      if (before.screen !== "playing" || rocks0.length === 0) {
        throw unmetPrecondition(
          `the field is not live with rocks on it (screen ${before.screen}, ${rocks0.length} ` +
            `rock(s)), so there is nothing drifting to observe`,
        );
      }
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      advanced = after.simTime - before.simTime;
      drifted = furthestDrift(rocks0, after.rocks || []);
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
        "...and the rocks actually drifted, so the simulation ran rather than a counter ticking",
        drifted,
        MIN_TRAVEL,
      );
    },
  };
}
