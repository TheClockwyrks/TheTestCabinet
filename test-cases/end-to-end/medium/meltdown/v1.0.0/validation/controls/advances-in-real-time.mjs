// Automated validation for controls.advances-in-real-time: during normal play the game runs
// itself. The animation loop drives the fixed tick from the wall clock
// (`specs/instrumentation.md`), so a surge unit walks the floor with nothing stepping it.
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a frozen floor. The spec puts the manual
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
// WHY THE UNIT IS SPAWNED RATHER THAN WAITED FOR. `startWave` does release a wave, but the spawn
// cadence is the build's own, so "a unit had appeared within two seconds" would pin a free choice
// — and worse, a frozen build spawns nothing, which would report as an unmet PRECONDITION rather
// than the failure it is. `spawnUnit` is a control op: it lands a unit instantly, on a frozen
// build as readily as on a live one, so the only thing left to observe is whether it then moves.

// Two seconds of real time. A Mote covers 60 px/s (`specs/surge.md`), so the pair of stills shows
// it a clear distance further along the maze.
const SETTLE_MS = 2000;
// Half the settle. Deliberately generous: the claim is that the game advances ITSELF, not that it
// keeps perfect time, and a build that clamps its per-frame delta (ordinary spiral-of-death
// protection) legally loses time to a stall. A running build lands near 2.0; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor the unit must travel, in logical px. A Mote covers 60 px/s, so even a clock managing a
// sixth of real time carries it 20 px. A second, independent witness: it says the SIMULATION ran,
// not merely that a counter ticked up.
const MIN_TRAVEL = 20;
// A beat so the record pass has an `act` to replay; the verdict is already fixed by `arrange`.
const TAIL_TICKS = 60;

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

const unitById = (s, id) => (s.surge || []).find((u) => u.id === id) ?? null;

export default function item() {
  let advanced;
  let travelled;

  return {
    id: "controls.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header.
      await api.call("startGame", "containment", "medium");
      await api.call("startWave"); // put the floor into its wave phase
      const id = await api.call("spawnUnit", "mote", "left");

      const before = await api.snapshot();
      const unit0 = unitById(before, id);
      if (!unit0) {
        throw unmetPrecondition(
          `the spawned Mote is not on the floor (phase ${before.phase}, ` +
            `${(before.surge || []).length} unit(s)), so there is nothing moving to observe`,
        );
      }
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      const unit1 = unitById(after, id);
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
        "...and the surge unit actually walked, so the simulation ran rather than a counter ticking",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
