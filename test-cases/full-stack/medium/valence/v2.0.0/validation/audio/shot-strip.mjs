// Automated validation for the Audio item `shot-strip`: a distinct cue plays when a
// damage tower fires (specs/assets.md: "the shot cue when a damage tower fires").
// Audio is read from the Web Audio sources the build starts (see `api.audio`). Audio
// is armed with a real gesture first (the game must not autoplay before the player
// interacts); then a real Emitter is placed beside a large atom — the same set-up
// `fx.strip` uses — and the sim runs on until the tower's shot is in flight. The audio
// log must grow across the shot.

import {
  coverAndSpawn,
  armAudio,
  audioCount,
  audioCountAbove,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let fired;

  return {
    id: "audio.shot-strip",

    async arrange(api) {
      await coverAndSpawn(api, { kind: "emitter", type: "atom", electrons: 6 });
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      // 180 ticks = the fx.strip cap; a shot is quick, so poll at the finest grain (TICK).
      const r = await api.until((s) => s.projectiles.length > 0, {
        max: 180,
        poll: TICK,
      });
      after = await audioCountAbove(api, before);
      fired = r.hit;
      await api.advance(30); // a short tail so the clip shows the shot
    },

    async assert(api, check) {
      check.expectOk("the tower fires a shot at the atom", fired);
      check.expectGt(
        "a shot cue plays on firing (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
