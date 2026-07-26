// Automated validation for the Audio item `music`: the produced industrial-electro
// reactor bed loops under play once the player first interacts. Audio is read from the Web
// Audio sources the build starts (see `api.audio`). A build phase is posed with NO prior
// interaction, then the arm itself (a real key tap and a corner click, `armAudio`) is the
// event under test — the audio log must grow once the gesture unlocks the build's
// `AudioContext` and it starts the loop (`audio.ts`'s `resume`/`startMusic`).

import { startBuild, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "audio.music",

    async arrange(api) {
      await startBuild(api); // no interaction yet — audio must not have autostarted
    },

    async act(api) {
      before = await audioCount(api);
      await armAudio(api); // the first genuine gesture; settles internally for the decode
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectEq("nothing plays before the first interaction", before, 0);
      check.expectGt(
        "the music bed starts once armed (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
