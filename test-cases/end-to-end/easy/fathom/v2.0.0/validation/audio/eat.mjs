// Automated validation for the Audio item `eat`: a short cue plays when the forager
// eats a plankton. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). The forager is placed on a fresh corridor tile (every open tile starts
// carrying a plankton, specs/gameplay.md), audio is armed with a real gesture, and the
// real per-step eat check is stepped so the pellet under the forager is eaten; the audio
// log must grow across it. Nothing here inspects the sound itself; only that one was
// scheduled in response to the eat.

import {
  startPlaying,
  findOpenWithNeighbor,
  armAudio,
  audioCount,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let ate;

  return {
    id: "audio.eat",

    async arrange(api) {
      const snap = await startPlaying(api);
      const spot = findOpenWithNeighbor(snap, "right"); // a fresh corridor tile (carries a plankton)
      await api.call("setForager", { tx: spot.tx, ty: spot.ty });
      await armAudio(api);
    },

    async act(api) {
      const scoreBefore = (await api.snapshot()).score;
      before = await audioCount(api);
      await api.advance(6); // 6 ticks = 0.05 s: the real eat check on the forager's tile
      after = await audioCount(api);
      const scoreAfter = (await api.snapshot()).score;
      ate = scoreAfter > scoreBefore;
      await api.advance(84); // a short tail so the clip shows the eat
    },

    async assert(api, check) {
      check.expectOk("the forager eats a plankton", ate);
      check.expectGt(
        "an eat cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
