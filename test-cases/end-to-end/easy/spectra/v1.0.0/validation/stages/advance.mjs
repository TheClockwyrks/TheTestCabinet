// Automated validation for the Stages sub-item `advance`.
//
// Destroying the whole formation clears the wave and advances to the next stage.
// The REAL stage-1 wave flies in and assembles, is raked down to its last drone
// instantly (`arrangeWaveToLastDrone`), and that last drone is then shot on camera:
// the field empties through the real collision, the real stage-end path ends the
// wave, and the real progression advances the stage.
//
// The old script posed a single drone into a `clearField`-emptied wave and shot
// that. See `arrangeWaveToLastDrone` for why that made the verdict depend on an
// unwritten side effect of `clearField` rather than on the progression this item is
// about.

import {
  startStageClean,
  arrangeWaveToLastDrone,
  exposedBand,
  shootFromLane,
  findDrone,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// Room for the last shot to fly up from the ship's lane to the formation.
const REACH_MAX_TICKS = 180;

// A beat on the last drone standing before it is shot, so a reviewer sees the wave
// down to its final target and can watch that specific kill trigger the clear —
// rather than the clip opening on a shot already in flight.
const BEFORE_LAST_SHOT_TICKS = LEAD_IN_TICKS + 60; // ~1.1 s

export default function item() {
  // The last drone of the real wave, and the two progression milestones.
  let lastId;
  let killed;
  let cleared;
  let next;

  return {
    id: "stages.advance",

    // The real stage-1 wave, assembled and raked down to one drone — all of it
    // instant, so the clip opens on the last drone still standing.
    async arrange(api) {
      await startStageClean(api, 1, { clear: false });
      lastId = await arrangeWaveToLastDrone(api);
    },

    async act(api) {
      // The wave as it stands: one drone left of the formation that flew in.
      await api.advance(BEFORE_LAST_SHOT_TICKS);

      if (lastId !== null) {
        // Aimed at whatever layer of the survivor is currently exposed, so the shot
        // is a real matching kill rather than a mismatch (see `exposedBand`).
        const snap = await api.snapshot();
        await shootFromLane(
          api,
          lastId,
          exposedBand(snap, findDrone(snap, lastId)),
        );
        killed = await api.until((s) => findDrone(s, lastId) === null, {
          max: REACH_MAX_TICKS,
        });
      }

      cleared = await api.until((s) => s.screen === "stageCleared", {
        max: 240,
      }); // 240 ticks = 2 s

      // The interstitial then advances to the next stage.
      next = await api.until((s) => s.stage === 2, { max: 480 }); // 480 ticks = 4 s
    },

    async assert(api, check) {
      check.expectOk(
        "the real wave was raked down to a last drone",
        lastId !== null,
      );
      check.expectOk(
        "the last drone of the formation is destroyed",
        killed?.hit,
      );
      check.expectOk("clearing the formation clears the wave", cleared.hit);
      check.expectEq(
        "the stage has not yet incremented at the interstitial",
        cleared.snap.stage,
        1,
      );
      check.expectOk("the cleared wave advances to the next stage", next.hit);
    },
  };
}
