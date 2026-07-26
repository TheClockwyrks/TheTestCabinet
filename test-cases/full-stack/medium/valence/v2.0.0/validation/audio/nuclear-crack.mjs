// Automated validation for the Audio item `nuclear-crack`: a distinct cue plays when a
// heavy isotope decays and sheds a fragment, or reaches a stable nucleus
// (specs/assets.md: "the crack when a heavy or boss splits"). Audio is read from the
// Web Audio sources the build starts (see `api.audio`). Audio is armed with a real
// gesture first, then a real Reactor cracks a heavy isotope — the same set-up
// `fx.split` uses — until it decays. The audio log must grow across the decay.

import { coverAndSpawn, armAudio, audioCount, TICK } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let decayed;

  return {
    id: "audio.nuclear-crack",

    async arrange(api) {
      await coverAndSpawn(api, { kind: "reactor", type: "isotope" });
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      // 300 ticks = the fx.split cap; a decay flash is short-lived, so poll at TICK.
      const r = await api.until(
        (s) => s.effects.some((e) => e.kind === "split"),
        { max: 300, poll: TICK },
      );
      after = await audioCount(api);
      decayed = r.hit;
      await api.advance(30); // a short tail so the clip shows the decay
    },

    async assert(api, check) {
      check.expectOk("the heavy isotope decays and sheds a fragment", decayed);
      check.expectGt(
        "a nuclear-crack cue plays on the decay (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
