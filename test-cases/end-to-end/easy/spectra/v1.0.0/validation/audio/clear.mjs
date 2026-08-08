// Automated validation for the Audio item `clear`: a cue plays when a stage
// clears. Audio is read from the Web Audio sources the build starts (see
// `api.audio`).
//
// The REAL stage-1 wave flies in and assembles, is raked down to its last drone
// instantly (`arrangeWaveToLastDrone`), and that last drone is shot: the field
// empties through the real collision, the real stage-end path ends the wave, and
// the audio log must grow across it. Same drive as `stages.advance` and
// `ui.state-stage-cleared`, which is the point — all three are about the same real
// stage-end.
//
// The old script posed a single drone into a `clearField`-emptied wave, so on a
// build that treats a debug clear as "posing a scenario" rather than "the player
// shot the last drone" the wave never ended, and this item reported a missing
// stage-clear cue for a stage that had never cleared. See `arrangeWaveToLastDrone`.

import {
  startStageClean,
  arrangeWaveToLastDrone,
  armAudio,
  actAudioCount,
  exposedBand,
  shootFromLane,
  findDrone,
} from "../_helpers.mjs";

// The last shot's flight up to the formation, plus the stage-end path resolving.
const CLEAR_MAX_TICKS = 300;

export default function item() {
  let before;
  let after;
  let cleared;
  let lastId;

  return {
    id: "audio.clear",

    // The real stage-1 wave, assembled and raked down to one drone — all instant,
    // so nothing of the rake reaches the clip or the audio window.
    async arrange(api) {
      await startStageClean(api, 1, { clear: false });
      lastId = await arrangeWaveToLastDrone(api);
      await armAudio(api);
    },

    async act(api) {
      // Counted immediately before the last shot. The window necessarily spans the
      // kill as well as the clear — a build ends the wave on the tick the field
      // empties, so there is no instant between them to read — and the driver's
      // probe records only THAT a source started, never which cue it was (see
      // `api.audio`). So this asserts that the stage-end produced sound, and the
      // kill cue is `audio.kill`'s to own. Which cue is which is a judgement for the
      // reviewer, from the clip.
      before = await actAudioCount(api);

      if (lastId !== null) {
        const snap = await api.snapshot();
        await shootFromLane(
          api,
          lastId,
          exposedBand(snap, findDrone(snap, lastId)),
        );
      }
      const r = await api.until((s) => s.screen === "stageCleared", {
        max: CLEAR_MAX_TICKS,
      });
      after = await actAudioCount(api);
      cleared = r.hit;
      await api.advance(30); // a short tail so the clip shows the interstitial
    },

    async assert(api, check) {
      check.expectOk(
        "the real wave was raked down to a last drone",
        lastId !== null,
      );
      check.expectOk("clearing the formation clears the wave", cleared);
      check.expectGt(
        "a clear cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
