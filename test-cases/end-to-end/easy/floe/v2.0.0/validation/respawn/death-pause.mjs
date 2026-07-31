// Automated validation for the Respawn item `death-pause`.
//
// Every death holds the crossing for a brief pause of about 1 s before the fresh
// critter appears, and the snapshot reports `phase` as `dying` for its duration
// (specs/gameplay.md, specs/instrumentation.md). A drowning is driven and the pause is
// measured from the tick the life was deducted to the tick the crossing is live again.
// See validation/_helpers.mjs.
//
// WHERE THE BAND COMES FROM. The spec asks for "about 1 s" and fixes no exact length,
// so this item fixes none either: it only bounds the reading either side, and says
// nothing in between. The floor is what makes the pause a pause at all — a build that
// resolves a death within the tick that caused it satisfies every other word of the
// rule while the player never sees a pause, and it hands the fresh critter straight
// back to a key that has not yet come up, so a tap that drowned the critter also walks
// it off the near shore. A tap is well under 0.2 s, so the floor sits clear of one. The
// ceiling only rules out a pause long enough to stall the run.

import { actUntilDeath, startCrossing, TICK } from "../_helpers.mjs";

// The lives the crossing starts with, so the death respawns rather than ending the run.
const LIVES = 3;

// The pause the spec asks for is about 1 s. These are the bounds either side of it: a
// pause shorter than the floor cannot do the job the spec gives it (a tap is still
// down), and one longer than the ceiling is no longer a beat but a stall.
const MIN_PAUSE_TICKS = 48; // 0.4 s
const MAX_PAUSE_TICKS = 240; // 2 s

// How long to keep sweeping for the fresh crossing before calling it never — well past
// the ceiling, so "too long" is told apart from "never came back".
const GIVE_UP_TICKS = 600; // 5 s

export default function item() {
  // The tick the life was deducted, and the sweep that waited for the crossing to be
  // live again — its `spent` is the length of the pause.
  let died;
  let fresh;

  return {
    id: "respawn.death-pause",

    // Pose a death: the critter over open water with lives to spare. The bear is taken
    // off the board so the drowning is the only thing that ends the crossing.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setBear", 0, null);
      await api.call("setLane", 5, { cols: [] }); // open water, no floe
      await api.call("placeCritter", 20, 5);
    },

    // The drowning, the pause it opens, and the crossing that resumes after it — what
    // is checked, and the clip.
    //
    // Both sweeps poll a single tick at a time: the whole item is a measurement of how
    // many ticks separate two events, so a coarser poll would quantise the very
    // quantity being read.
    async act(api) {
      died = await actUntilDeath(api, LIVES, { max: 240, poll: TICK });
      fresh = await api.until((s) => s.phase === "crossing", {
        max: GIVE_UP_TICKS,
        poll: TICK,
      });
    },

    async assert(api, check) {
      check.expectOk("the drowning costs a life", died.hit);
      check.expectEq(
        "the phase is dying for the death pause",
        died.snap.phase,
        "dying",
      );
      check.expectOk("the crossing resumes after the pause", fresh.hit);
      // A sweep that never found the fresh crossing spent its whole budget, which would
      // sail over the floor and land under no ceiling; read that as no pause at all so
      // it fails beside the assertion above rather than holding vacuously.
      const pause = fresh.hit ? fresh.spent : 0;
      check.expectGe(
        "the death pause is long enough to read, and to outlast a tap",
        pause,
        MIN_PAUSE_TICKS,
      );
      check.expectLe(
        "the death pause is a beat, not a stall",
        pause,
        MAX_PAUSE_TICKS,
      );
      check.expectEq(
        "the critter is out of play for the pause — no second life is lost in it",
        fresh.snap.lives,
        died.snap.lives,
      );
    },
  };
}
