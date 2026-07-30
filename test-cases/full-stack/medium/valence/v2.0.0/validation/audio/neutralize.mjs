// Automated validation for the Audio item `neutralize`: a distinct cue plays when a
// unit is fully broken down (specs/assets.md: "the chime on a neutralize"). Audio is
// read from the Web Audio sources the build starts (see `api.audio`). Audio is armed
// with a real gesture first, then a real Emitter poses a 1-electron atom — the same
// set-up `fx.neutralize` uses, which the tower's first shot kills outright.
//
// The cue is measured across the ONE IMPACT that kills the atom (`cueOnImpact`), with the
// shot that carries it already in the air so its own launch cue is behind the baseline. A
// damage tower plays a cue every time it fires (specs/assets.md, "the shot cue when a damage
// tower fires"), so comparing the log across the whole window instead would grow on the shot
// alone and pass a build with no neutralize cue at all.

import { coverAndSpawn, armAudio, cueOnImpact } from "../_helpers.mjs";

const TAIL_TICKS = 60; // 60 ticks = 1 s, so the clip shows the kill and its burst

export default function item() {
  let unitId;
  let cue;

  return {
    id: "audio.neutralize",

    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "emitter",
        type: "atom",
        electrons: 1,
      }));
      await armAudio(api);
    },

    async act(api) {
      cue = await cueOnImpact(api, unitId, (s) =>
        s.effects.some((e) => e.kind === "neutralize"),
      );
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the atom is neutralized", cue.hit);
      check.expectGt(
        "a neutralize cue plays on the kill itself (Web Audio sources started)",
        cue.gained,
        0,
      );
    },
  };
}
