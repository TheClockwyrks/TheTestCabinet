// Automated validation for the Audio item `bond-snap`: a distinct cue plays when a
// bonded cluster's outer bond pool is chipped or broken through (specs/assets.md:
// "the snap on a chipped bond"). Audio is read from the Web Audio sources the build
// starts (see `api.audio`). Audio is armed with a real gesture first, then a real
// Cleaver chips a Polymer — the same set-up `fx.bondsnap` uses, pointed at the LAST unit
// in range so the tower stays on the pool rather than drifting onto the atoms it sheds.
//
// The cue is measured across the ONE IMPACT that snaps the bond (`cueOnImpact`), not
// across the whole window it took to get there. A damage tower plays a cue every time it
// fires, so a window long enough to contain a snap also contains several shot cues and the
// audio log grows whether or not the snap has a cue of its own: this item previously
// recorded "a bond-snap cue plays on the snap" as SATISFIED on a run where the bond never
// snapped at all, on the strength of those shot cues alone.

import {
  coverAndPassThrough,
  focusOnParent,
  armAudio,
  cueOnImpact,
} from "../_helpers.mjs";

const TAIL_TICKS = 90; // 90 ticks = 1.5 s, so the clip shows the snap and its aftermath

export default function item() {
  let unitId;
  let cue;

  return {
    id: "audio.bond-snap",

    async arrange(api) {
      ({ unitId } = await coverAndPassThrough(api, {
        kind: "cleaver",
        type: "polymer",
      }));
      await focusOnParent(api);
      await armAudio(api);
    },

    async act(api) {
      cue = await cueOnImpact(api, unitId, (s) =>
        s.effects.some((e) => e.kind === "bondsnap"),
      );
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a bond snaps and sheds a free atom", cue.hit);
      check.expectGt(
        "a bond-snap cue plays on the snap itself (Web Audio sources started)",
        cue.gained,
        0,
      );
    },
  };
}
