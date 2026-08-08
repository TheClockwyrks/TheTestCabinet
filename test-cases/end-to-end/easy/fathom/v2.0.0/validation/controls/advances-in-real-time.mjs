// Automated validation for controls.advances-in-real-time: during normal play the game runs
// itself. The animation loop drives the fixed tick from the wall clock
// (`specs/instrumentation.md`), so the reef lives — the predators patrol — with nothing stepping it.
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a frozen dive. The spec puts the manual
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
// THE WITNESS IS A PREDATOR, NOT THE FORAGER. The forager is the player's, and sits exactly where
// it was left unless something presses a key. The predators swim their own patrol, so they are
// what moves when — and only when — the game is running itself.

import { unmetPrecondition } from "../_helpers.mjs";

// Two seconds of real time. A predator covers ground at its own pace, and two seconds is enough
// for the pair of stills to show it somewhere clearly different.
const SETTLE_MS = 2000;
// Half the settle. Deliberately generous: the claim is that the game advances ITSELF, not that it
// keeps perfect time, and a build that clamps its per-frame delta (ordinary spiral-of-death
// protection) legally loses time to a stall. A running build lands near 2.0; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor a patrolling predator must cover, in logical px. They move at ~64-116 px/s, so even a
// clock managing a sixth of real time carries one 20 px. A second, independent witness: it says the
// SIMULATION ran, not merely that a counter ticked up.
const MIN_TRAVEL = 20;
// A beat so the record pass has an `act` to replay; the verdict is already fixed by `arrange`.
const TAIL_TICKS = 120;

export default function item() {
  let advanced;
  let travelled;

  return {
    id: "controls.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header.
      await api.call("startDive");
      await api.call("beginPlay"); // end the dive countdown now, so the reef is already live

      const before = await api.snapshot();
      const hunter0 = (before.predators || [])[0];
      if (before.screen !== "playing" || !hunter0) {
        throw unmetPrecondition(
          `the dive is not live with a predator on the reef (screen ${before.screen}, ` +
            `${(before.predators || []).length} predator(s)), so there is nothing moving to observe`,
        );
      }
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      const hunter1 = (after.predators || [])[0];
      advanced = after.simTime - before.simTime;
      travelled = hunter1
        ? Math.hypot(hunter1.x - hunter0.x, hunter1.y - hunter0.y)
        : 0;
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
        "...and a predator actually swam, so the simulation ran rather than a counter ticking",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
