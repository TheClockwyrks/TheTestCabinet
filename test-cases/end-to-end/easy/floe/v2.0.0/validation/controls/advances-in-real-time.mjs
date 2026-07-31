// Automated validation for controls.advances-in-real-time: during normal play the game runs
// itself. The animation loop drives the fixed tick from the wall clock
// (`specs/instrumentation.md`), so the strait flows — the lane traffic moves — with nothing
// stepping it.
//
// WHY THIS ITEM EXISTS. Every other scripted item advances the simulation itself, through the
// runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`. That makes
// them blind to this claim: a build whose own frame loop never runs still answers `step` perfectly
// and passes them all, while a person who opens it sees a frozen strait. The spec puts the manual
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
// THE WITNESS IS THE TRAFFIC, NOT THE CRITTER. The critter is the player's and does not move
// unless a key is pressed. The lane traffic runs on the level's own lane speeds, so it is what
// moves when — and only when — the game is running itself. It is read as a whole rather than
// per-item because traffic wraps off one edge and back on the other, so an item's index is not a
// stable handle across the window; what the item claims is that the traffic is no longer where it
// was, and comparing the whole row says exactly that.

// Two seconds of real time, which at the level's lane speeds is several tiles of traffic — enough
// for the pair of stills to read as two different moments.
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

/**
 * Each lane's traffic positions, one string per lane. Kept per-lane rather than as one blob so a
 * failure reports HOW MANY lanes stood still rather than dumping every coordinate into the run
 * record.
 */
function trafficPositions(s) {
  const lanes = [...((s.lanes && s.lanes.ice) || []), ...((s.lanes && s.lanes.water) || [])];
  return lanes.map((lane) => (lane.items || []).map((it) => Math.round(it.x)).join(","));
}

export default function item() {
  let advanced;
  let lanesMoved;

  return {
    id: "controls.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header.
      await api.call("startGame");

      const s0 = await api.snapshot();
      const before = trafficPositions(s0);
      if (s0.screen !== "playing" || before.length === 0) {
        throw unmetPrecondition(
          `the crossing is not live with traffic in the lanes (screen ${s0.screen}), so there is ` +
            `nothing moving to observe`,
        );
      }
      await api.screenshot("before");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const s1 = await api.snapshot();
      const after = trafficPositions(s1);
      lanesMoved = before.filter((row, i) => row !== after[i]).length;
      advanced = s1.simTime - s0.simTime;
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
        "...and the lane traffic actually moved, so the simulation ran rather than a counter ticking",
        lanesMoved,
        0,
      );
    },
  };
}
