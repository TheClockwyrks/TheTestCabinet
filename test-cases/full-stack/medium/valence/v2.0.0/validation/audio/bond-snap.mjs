// Automated validation for the Audio item `bond-snap`: a distinct cue plays when a
// bonded cluster's outer bond pool is chipped or broken through (specs/assets.md:
// "the snap on a chipped bond"). Audio is read from the Web Audio sources the build
// starts (see `api.audio`). Audio is armed with a real gesture first, then a real
// Cleaver chips a Polymer — the same set-up `fx.bondsnap` uses — until a bond snaps and
// sheds a free atom. The audio log must grow across the snap.

import { coverAndSpawn, armAudio, audioCount, TICK } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let snapped;

  return {
    id: "audio.bond-snap",

    async arrange(api) {
      await coverAndSpawn(api, { kind: "cleaver", type: "polymer" });
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      // 300 ticks = the fx.bondsnap cap; a snap is short-lived, so poll at TICK.
      const r = await api.until(
        (s) => s.effects.some((e) => e.kind === "bondsnap"),
        { max: 300, poll: TICK },
      );
      after = await audioCount(api);
      snapped = r.hit;
      await api.advance(30); // a short tail so the clip shows the snap
    },

    async assert(api, check) {
      check.expectOk("a bond snaps and sheds a free atom", snapped);
      check.expectGt(
        "a bond-snap cue plays on the snap (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
