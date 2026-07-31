// Automated validation for the Audio item `fire`: a cue plays when the ship fires a
// bullet. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). The fire key is held briefly from a clean wave; the real fire code
// spawns a friendly bullet, and the audio log must grow across it.

import {
  startClean,
  armAudio,
  actAudioCount,
  friendlyBullets,
} from "../_helpers.mjs";

const HOLD_TICKS = 6; // 6 ticks = 0.05 s: a brief hold, plenty for one shot to land

export default function item() {
  let before;
  let after;
  let fired;

  return {
    id: "audio.fire",

    async arrange(api) {
      await startClean(api);
      await api.call("setShipBand", "cyan");
      await armAudio(api);
    },

    async act(api) {
      before = await actAudioCount(api);
      await api.call("keyDown", "Space");
      await api.advance(HOLD_TICKS);
      await api.call("keyUp", "Space");
      after = await actAudioCount(api);
      fired = friendlyBullets(await api.snapshot()).length > 0;
      await api.advance(30); // a short tail so the clip shows the shot
    },

    async assert(api, check) {
      check.expectOk("the ship fires a bullet", fired);
      check.expectGt(
        "a fire cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
