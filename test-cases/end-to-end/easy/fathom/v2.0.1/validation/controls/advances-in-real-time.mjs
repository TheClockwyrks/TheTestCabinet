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
// THE WITNESS IS THE FORAGER UNDER A HELD KEY. It used to be a patrolling predator, on the grounds
// that the forager sits where it was left unless something presses a key — so this presses one.
// Holding a direction is an input op, which changes nothing about `autoStep`
// (`specs/instrumentation.md`), and a held key only sets the desired direction: the travel itself
// happens in the fixed-step update the frame loop drives. So a forager that moves is proof the
// build ran its own loop, and a frozen build's forager sits exactly still.
//
// The predator was the wrong witness twice over. It wanders where its own mind takes it, so what
// this measured — the straight line between where it stood at each end of the window — is its
// DISPLACEMENT, not how far it swam: a patrol that rounds a corner and comes back covers a couple
// of hundred px and reports nearly zero. A run failed here at `0.53 px` of predator displacement
// while its clock advanced the full `2.0 s` and its forager swam `258 px`, which is the item's own
// claim holding perfectly. And the predator roster is the den's to schedule
// (`specs/predators.md`), so which hunter is out, and whether it is still filing through the gate,
// varies between conforming builds. The forager under a held key is none of those things: it is
// driven, its direction is the one this check chose, and how far it should have gone is arithmetic.

import { poseStraightRun, DIR_KEY, unmetPrecondition } from "../_helpers.mjs";

// Two seconds of real time. At the forager's `128 px/s` that is eight tiles, enough for the pair
// of stills to show it somewhere clearly different.
const SETTLE_MS = 2000;
// Half the settle. Deliberately generous: the claim is that the game advances ITSELF, not that it
// keeps perfect time, and a build that clamps its per-frame delta (ordinary spiral-of-death
// protection) legally loses time to a stall. A running build lands near 2.0; a frozen one reports 0.
const MIN_ADVANCE = SETTLE_MS / 1000 / 2;
// The floor the forager must cover, in logical px. It swims at `128 px/s` (`specs/movement.md`), so
// two seconds is `256 px` and even a clock managing a sixth of real time carries it `42 px`. The
// floor is `20 px` — under a tile, and far under any of that — because this is a second,
// independent witness that the SIMULATION ran, not a measurement of how fast it runs. A frozen
// build reports `0`.
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

      // A corridor long enough to hold the whole window: twelve tiles is `384 px` against the
      // `256 px` the forager covers in two seconds, so it never runs out of water and the travel
      // below is bounded by the clock rather than by rock. The spare pocket keeps pellets the
      // forager cannot reach, so grazing the run cannot clear the maze mid-measurement.
      const run = await poseStraightRun(api, 12, { spare: true });
      await api.call("setForager", { tx: run.tx, ty: run.ty, dir: run.dir });
      await api.call("setBrightness", 1); // so the two stills show a lit corridor, not the dark

      const before = await api.snapshot();
      if (before.screen !== "playing") {
        throw unmetPrecondition(
          `the dive is not live (screen ${before.screen}), so there is nothing running to observe`,
        );
      }
      await api.screenshot("before");

      // The measurement: real wall-clock time, with the key held and nothing driving the build but
      // its own loop. `keyDown` and `settle` both leave `autoStep` exactly as the build booted it.
      await api.call("keyDown", DIR_KEY[run.dir]);
      await api.settle(SETTLE_MS);

      const after = await api.snapshot();
      advanced = after.simTime - before.simTime;
      travelled = Math.hypot(
        after.forager.x - before.forager.x,
        after.forager.y - before.forager.y,
      );
      await api.screenshot("after");
      await api.call("keyUp", DIR_KEY[run.dir]);
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
        "...and the forager actually swam under a held key, so the simulation ran rather than a counter ticking",
        travelled,
        MIN_TRAVEL,
      );
    },
  };
}
