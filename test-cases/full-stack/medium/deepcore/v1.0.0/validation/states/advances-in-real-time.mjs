// Automated validation for states.advances-in-real-time: during normal play the game runs itself.
// The animation loop drives the fixed tick from the wall clock, so an expedition's simulation
// advances with nothing stepping it — `specs/instrumentation.md`: "The game holds an `autoStep`
// flag, default true (normal human play)."
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a frozen mine. `reset` and `step` both set
// `autoStep` to false, so a build that calls its own `reset` on the boot path ships with the flag
// off and never advances for a player.
//
// WHY THE MEASUREMENT LIVES IN `arrange`. Catching that means observing the clock the build BOOTS
// with, and the window is narrow: `api.reset` hands the clock back by forcing `setAutoStep(true)`,
// `api.skip` does the same, and the runtime sets the flag explicitly between `arrange` and `act`.
// So everything here is `arrange`, poses with CONTROL OPS ONLY — no reset, no step, no skip (the
// spec is explicit that "control operations do not change `autoStep`") — and measures real elapsed
// time with `api.settle`, which is genuinely wall-clock in both passes. Do not rewrite this onto a
// helper that opens with a reset; that would mask the defect it hunts.
//
// WHY STILLS RATHER THAN A CLIP. The record pass turns `autoStep` ON for `act`, so a filmed `act`
// animates even for a build that boots frozen — the video would show the very motion the item says
// is missing. Two stills taken around the settle show it honestly. The record pass opens a fresh
// page, so its `arrange` sees the boot clock too.
//
// WHY A KEY IS HELD ACROSS THE MEASUREMENT. Nothing in the mine moves on its own: the miner is
// the player's and holds station until it is driven, so unlike the other cases there is no
// bystander whose motion proves the world ran. Posed without one, the two stills came back
// PIXEL-IDENTICAL against the reference — media that cannot tell a running build from a stopped
// one, which is the whole job. So the scenario does what a player does: it holds a direction down
// (`specs/controls.md`: "The miner is driven continuously — hold a direction to keep
// moving/drilling") for the length of the window. Input operations do not touch the clock
// (`specs/instrumentation.md`: "control operations do not change `autoStep`"), so this changes
// what there is to see without changing what is being measured — and the miner only actually
// travels if the build is advancing itself.
//
// The flag is read as well, because this case reports `autoStep` directly in its snapshot
// (`specs/instrumentation.md`) — the exact state the spec fixes, read at boot before anything has
// had a chance to change it.

// Two seconds of real time, enough that a stopped clock and a running one are unmistakable.
const SETTLE_MS = 2000;
// Half the settle. Deliberately generous: the claim is that the game advances ITSELF, not that it
// keeps perfect time, and a build that clamps its per-frame delta (ordinary spiral-of-death
// protection) legally loses time to a stall. A running build lands near 2.0; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
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

// The floor the miner must travel while a direction is held, in logical px. A second witness
// alongside the flag: it says the SIMULATION ran, not merely that a counter ticked up.
const MIN_TRAVEL = 20;

export default function item() {
  let advanced;
  let bootFlag;
  let travelled;

  return {
    id: "states.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header.
      await api.call("startExpedition", "standard", "quick");

      const before = await api.snapshot();
      if (before.screen !== "in-mine") {
        throw unmetPrecondition(
          `starting an expedition did not drop the miner into the mine (screen ${before.screen}), ` +
            `so there is no running simulation to observe`,
        );
      }
      // Read the flag the build BOOTED with, before the runtime takes the clock over.
      bootFlag = before.autoStep;
      const miner0 = before.miner || { x: 0, y: 0 };
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      // The direction is held across it, the way a player drives the miner — see the header.
      await api.call("keyDown", "ArrowRight");
      await api.settle(SETTLE_MS);
      await api.call("keyUp", "ArrowRight");

      const after = await api.snapshot();
      const miner1 = after.miner || miner0;
      advanced = after.simTime - before.simTime;
      travelled = Math.hypot(miner1.x - miner0.x, miner1.y - miner0.y);
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
      check.expectEq(
        "...and the build reports the clock as its own, the default for normal play",
        bootFlag,
        true,
      );
      check.expectGt(
        "...and the miner actually drove while its key was held, so the simulation ran",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
