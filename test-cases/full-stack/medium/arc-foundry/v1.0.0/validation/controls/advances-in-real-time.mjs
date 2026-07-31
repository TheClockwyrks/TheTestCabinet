// Automated validation for controls.advances-in-real-time: during normal play the game runs
// itself. The animation-frame loop drives the fixed 60 Hz tick from the wall clock
// (`specs/controls.md`, `specs/instrumentation.md`), so a live wave progresses — time accumulates
// and the Load walks — with nothing driving it from outside.
//
// WHY THIS ITEM EXISTS. Every other scripted item in this case advances the simulation itself,
// through the runtime's `advance`/`until`/`skip`, which all bottom out in the debug API's `step`.
// That is exactly what makes them blind to this claim: a build whose own frame loop never runs
// still answers `step` perfectly and passes all of them, while a person who opens it sees a board
// that never moves. `specs/instrumentation.md` puts the manual clock behind an `autoStep` flag
// that is on by default for normal play and is turned OFF by `reset` and `step` — so a build that
// calls its own `reset` on the boot path ships with the flag off and never advances for a player,
// with nothing in a step-driven suite to say so.
//
// WHY THE MEASUREMENT LIVES IN `arrange`. Catching it means observing the clock the build BOOTS
// with, and that window is narrow: `api.reset` hands the clock back by forcing `setAutoStep(true)`,
// `api.skip` does the same, and `runPass` sets the flag explicitly between `arrange` and `act`. So
// everything here is `arrange`, poses the board with CONTROL OPS ONLY — no reset, no step, no skip
// — and measures real elapsed time with `api.settle`, which is genuinely wall-clock in both passes.
// Nothing in this file may be rewritten to use the shared helpers that open with `startBuild`:
// that resets, and a reset would hand the clock back and mask the very defect this item hunts.
//
// WHY STILLS RATHER THAN A CLIP. The record pass turns `autoStep` ON for `act`, so a filmed `act`
// animates even for a build that boots frozen — the video would show the exact motion the item
// says is missing. Two stills taken around the settle show it honestly: the reference's Mote has
// walked clear of the Entry, a frozen build's is still standing on it. The record pass opens a
// fresh page (a new context per pass), so its `arrange` sees the boot clock too and the stills
// depict what the verdict measured.

import { LOAD, unitById, unmetPrecondition, SECOND } from "../_helpers.mjs";

// Two seconds of REAL time. The verdict would be just as decided in one — a stopped clock reports
// exactly 0 either way — but the stills are the half of this item a reviewer actually looks at,
// and a Mote's 60 px/s roster speed turns two seconds into ~120 px, six tiles of visible travel
// along the entry corridor. At one second the pair differed by a sprite's width, which is a hard
// thing to see and an easy thing to mistake for a rendering wobble.
const SETTLE_MS = 2000;
// The floor the clock must clear, in seconds of accumulated simulation time. Half of the settle,
// which is deliberately generous: the claim is that the game advances ITSELF, not that it keeps
// perfect time, and a loaded machine may deliver fewer frames than a second of animation would.
// A build driving its own tick lands near 1.0; a build waiting to be stepped reports exactly 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor the released unit must travel, in logical px. A Mote covers 60 px/s
// (`specs/enemies.md`), so even a clock managing a quarter of real time moves it 15 px. This is a
// second, independent witness: it says the SIMULATION ran, not merely that a counter ticked up.
const MIN_TRAVEL = LOAD.mote.speed * 0.25;
// A beat so the record pass has an `act` to replay. The verdict is already fixed by `arrange`;
// this only lets the page paint after the second still.
const TAIL_TICKS = 1 * SECOND;

export default function item() {
  // Everything `assert` reads, all measured in `arrange` before the runtime takes the clock.
  let advanced;
  let travelled;

  return {
    id: "controls.advances-in-real-time",

    async arrange(api) {
      // Control ops only, and never `api.reset` — see the header. `startRun` opens the run
      // without touching the clock, and `spawnUnit` is the one control op that starts the floor
      // running (`specs/instrumentation.md`), putting the run into a live wave with NO composed
      // wave behind it — so the only thing moving is the unit this item released.
      await api.call("startRun", { map: "substation", difficulty: "medium" });
      await api.call("spawnUnit", "mote", {});

      const before = await api.snapshot();
      const unit = before.units[0];
      if (before.phase !== "wave" || !unit) {
        throw unmetPrecondition(
          `releasing a unit did not put the run on a live floor (phase ${before.phase}, ` +
            `${before.units.length} unit(s)), so there is no running simulation to observe`,
        );
      }
      await api.screenshot("released");

      // The measurement: real wall-clock time, with nothing driving the build but its own loop.
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      const moved = unitById(after, unit.id);
      advanced = after.simTime - before.simTime;
      travelled = moved ? Math.hypot(moved.x - unit.x, moved.y - unit.y) : 0;
      await api.screenshot("advanced");
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
        "...and the Load actually walked, so the simulation ran rather than a counter ticking",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
