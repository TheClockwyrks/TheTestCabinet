// Automated validation for the Audio item `neutralize`: a distinct cue plays when a
// unit is fully broken down (specs/assets.md: "the chime on a neutralize"). Audio is
// read from the Web Audio sources the build starts (see `api.audio`). Audio is armed
// with a real gesture first, then a real Emitter poses a 1-electron atom — the same
// set-up `fx.neutralize` uses, which the tower's first shot kills outright — until it
// is neutralized. The audio log must grow across the kill.

import { coverAndSpawn, armAudio, audioCount, TICK } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let neutralized;

  return {
    id: "audio.neutralize",

    async arrange(api) {
      await coverAndSpawn(api, { kind: "emitter", type: "atom", electrons: 1 });
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      // 180 ticks = the fx.neutralize cap; the burst is short-lived, so poll at TICK.
      const r = await api.until(
        (s) => s.effects.some((e) => e.kind === "neutralize"),
        { max: 180, poll: TICK },
      );
      after = await audioCount(api);
      neutralized = r.hit;
      await api.advance(30); // a short tail so the clip shows the kill
    },

    async assert(api, check) {
      check.expectOk("the atom is neutralized", neutralized);
      check.expectGt(
        "a neutralize cue plays on the kill (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
