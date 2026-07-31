// Automated validation for controls.advances-in-real-time: during normal play the game runs
// itself. The animation loop drives the fixed tick from the wall clock
// (`specs/instrumentation.md`), so the snake crawls with nothing stepping it.
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a snake that never moves. The spec puts
// the manual clock behind an `autoStep` flag that is on by default and that `reset` and `step`
// turn OFF, so a build that calls its own `reset` on the boot path ships with the flag off and
// never advances for a player.
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

// ONE second of real time, not the two most of these cases use. The snake advances 8 cells a
// second and starts mid-board heading for the right wall: measured against both reference
// variants it runs out of board and dies at about 1.75 s, which ends the round and stops the very
// clock being measured. A second leaves it crawling in open board with cells to spare, and is
// still eight cells of unmistakable travel.
//
// A build whose snake happens to die sooner is not misread: the round ending freezes `simTime`
// where it stopped, and any death inside the window means the snake crawled to meet it, so both
// witnesses have already moved.
const SETTLE_MS = 1000;
// The floor the clock must clear, in seconds of accumulated simulation time. Half the settle,
// deliberately generous: the claim is that the game advances ITSELF, not that it keeps perfect
// time, and a build that clamps its per-frame delta (ordinary spiral-of-death protection) legally
// loses time to a stall. A build driving its own tick lands near 1.0; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor the head must cover, in grid cells. The snake steps 8 cells a second, so even a clock
// managing a third of real time moves it 2. A second, independent witness: it says the SIMULATION
// ran, not merely that a counter ticked up.
const MIN_CELLS = 2;
// A beat so the record pass has an `act` to replay; the verdict is already fixed by `arrange`.
// The timestep is 8 Hz here, so this is one second.
const TAIL_TICKS = 8;

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

export default function item() {
  let advanced;
  let cells;

  return {
    id: "controls.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header.
      await api.call("startRound");

      const before = await api.snapshot();
      const head0 = (before.snake || [])[0];
      if (before.screen !== "playing" || !head0) {
        throw unmetPrecondition(
          `starting a round did not put a snake on a live board (screen ${before.screen}, ` +
            `${(before.snake || []).length} segment(s)), so there is nothing crawling to observe`,
        );
      }
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      const head1 = (after.snake || [])[0];
      advanced = after.simTime - before.simTime;
      cells = head1
        ? Math.abs(head1.col - head0.col) + Math.abs(head1.row - head0.row)
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
        "...and the snake actually crawled, so the simulation ran rather than a counter ticking",
        cells,
        MIN_CELLS,
      );
    },
  };
}
