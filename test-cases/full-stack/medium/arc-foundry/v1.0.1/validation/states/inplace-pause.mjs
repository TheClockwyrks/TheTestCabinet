// Automated validation for states.inplace-pause: the in-place pause freezes all ticks (sim
// time stops advancing) while the screen stays on the board with no menu, then resumes.
//
// Opening the run and putting a unit on the floor are control ops (the arrange). Everything
// else is the behavior under test: the board runs, the pause freezes it, a full second of
// advancing moves nothing, and the resume brings it back. That whole sequence is the act, which
// makes the clip show a freeze and a resume rather than a board that was already frozen.
//
// Note `simTime` is reported in SECONDS even though stepping counts ticks; the assertion below
// compares simTime to ITSELF either side of the pause, so the two units never meet.

import { startBuild, spawnControlled, snap, SECOND } from "../_helpers.mjs";

// 0.3 s = 18 ticks of live motion first, so the freeze reads as a change.
const BEFORE_PAUSE_TICKS = 0.3 * SECOND;
// A full second of advancing while paused: the sim clock must not move at all.
const FROZEN_TICKS = 1 * SECOND;
// Then resume and show motion returning.
const RESUMED_TICKS = 1.5 * SECOND;

export default function item() {
  // The sim clock before the pause and after advancing through it, plus the paused board.
  let t0;
  let sp;
  let tFrozen;

  return {
    id: "states.inplace-pause",

    async arrange(api) {
      await startBuild(api);
      await spawnControlled(api, "mote"); // a live wave (units on the floor)
    },

    async act(api) {
      await api.advance(BEFORE_PAUSE_TICKS);
      t0 = (await snap(api)).simTime;

      await api.call("press", "Space"); // in-place pause
      sp = await snap(api);

      await api.advance(FROZEN_TICKS); // advancing does nothing while paused
      tFrozen = (await snap(api)).simTime;

      await api.call("press", "Space"); // resume, then show motion
      await api.advance(RESUMED_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the in-place pause is set", sp.paused === true);
      check.expectEq("...the screen stays on the board (no menu)", sp.screen, "playing");
      check.expectClose("ticks are frozen while paused (sim time does not advance)", tFrozen, t0, 1e-6);
    },
  };
}
