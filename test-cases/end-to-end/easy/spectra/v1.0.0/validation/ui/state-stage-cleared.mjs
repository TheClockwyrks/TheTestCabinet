// Automated validation for the UI sub-item `state-stage-cleared`: the stage-cleared
// interstitial is reachable, and captured for the reviewer.
//
// The REAL stage-1 wave flies in and assembles, is raked down to its last drone
// instantly (`arrangeWaveToLastDrone`), and that last drone is shot on camera. The
// field empties through the real collision, the real stage-end path lands on the
// stage-cleared interstitial, and that is what is read back and captured.
//
// The old script posed a single drone into a `clearField`-emptied wave and shot
// that, which made "is the interstitial reachable?" depend on an unwritten side
// effect of `clearField` — and reported a blank screen for a build whose
// STAGE 1 CLEARED screen is perfectly reachable in play. See
// `arrangeWaveToLastDrone`.

import {
  startStageClean,
  arrangeWaveToLastDrone,
  exposedBand,
  shootFromLane,
  findDrone,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// The last shot's flight up to the formation, plus the stage-end path resolving
// behind it.
const CLEAR_MAX_TICKS = 300;

export default function item() {
  // The last drone of the real wave, and the moment the interstitial appeared.
  let lastId;
  let r;

  return {
    id: "ui.state-stage-cleared",

    // The real stage-1 wave, assembled and raked down to one drone — all instant,
    // so the clip opens on the last drone still standing.
    async arrange(api) {
      await startStageClean(api, 1, { clear: false });
      lastId = await arrangeWaveToLastDrone(api);
    },

    async act(api) {
      // A beat on the wave's last drone before it is shot.
      await api.advance(LEAD_IN_TICKS);

      if (lastId !== null) {
        const snap = await api.snapshot();
        await shootFromLane(
          api,
          lastId,
          exposedBand(snap, findDrone(snap, lastId)),
        );
      }
      r = await api.until((s) => s.screen === "stageCleared", {
        max: CLEAR_MAX_TICKS,
      });

      // A real pause so the interstitial has been painted before it is captured.
      await api.settle(120);
      await api.screenshot("cleared");
    },

    async assert(api, check) {
      check.expectOk(
        "the real wave was raked down to a last drone",
        lastId !== null,
      );
      check.expectOk(
        "clearing the wave reaches the stage-cleared screen",
        r.hit,
      );
    },
  };
}
