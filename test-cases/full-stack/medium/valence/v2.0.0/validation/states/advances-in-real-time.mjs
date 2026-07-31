// Automated validation for states.advances-in-real-time: during normal play the game runs itself.
// The animation-frame loop drives the fixed tick from the wall clock (`specs/instrumentation.md`),
// so matter flows along its path with nothing stepping it.
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a frozen board. The spec puts the manual
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
// WHY A SCENARIO ROUND. `startScenario` opens a live round the wave system leaves empty and that
// does not end on its own (`specs/instrumentation.md`), so the board is running but nothing else is
// walking through the measurement. `spawnUnit` then puts exactly one unit on a path — a control op,
// so it lands on a frozen build as readily as on a live one, leaving the only question whether it
// then flows.

import { preconditionUnmet } from "../_helpers.mjs";

// Two seconds of real time, which carries a flowing unit a clear distance along its path.
const SETTLE_MS = 2000;
// Half the settle. Deliberately generous: the claim is that the game advances ITSELF, not that it
// keeps perfect time, and a build that clamps its per-frame delta (ordinary spiral-of-death
// protection) legally loses time to a stall. A running build lands near 2.0; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor the unit must travel, in board px. A second, independent witness: it says the
// SIMULATION ran, not merely that a counter ticked up.
const MIN_TRAVEL = 20;
// A beat so the record pass has an `act` to replay; the verdict is already fixed by `arrange`.
const TAIL_TICKS = 60;

export default function item() {
  let advanced;
  let travelled;

  return {
    id: "states.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header.
      const title = await api.snapshot();
      const map = (title.maps || [])[0];
      if (!map) {
        throw preconditionUnmet(
          "the build offers no maps to open a run on, so there is no board to observe",
        );
      }
      await api.call("selectMap", map.id);
      await api.call("startScenario");
      const id = await api.call("spawnUnit", {});

      const before = await api.snapshot();
      const unit0 = (before.matter || []).find((m) => m.id === id) ?? (before.matter || [])[0];
      if (before.phase !== "round" || !unit0) {
        throw preconditionUnmet(
          `the scenario round is not live with a unit on a path (phase ${before.phase}, ` +
            `${(before.matter || []).length} unit(s)), so there is nothing flowing to observe`,
        );
      }
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      const unit1 = (after.matter || []).find((m) => m.id === unit0.id);
      advanced = after.simTime - before.simTime;
      travelled = unit1 ? Math.hypot(unit1.x - unit0.x, unit1.y - unit0.y) : 0;
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
        "...and the matter actually flowed, so the simulation ran rather than a counter ticking",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
