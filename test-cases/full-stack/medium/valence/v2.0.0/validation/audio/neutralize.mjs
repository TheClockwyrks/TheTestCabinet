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

import {
  coverAndPassThrough,
  armAudio,
  cueOnImpact,
  unitById,
} from "../_helpers.mjs";

// A 4-electron atom posed at the UPSTREAM edge of the tower's range, not a 1-electron one
// dropped on top of it. A 1-electron atom is the fastest there is (112 px/s, specs/matter.md)
// and an Emitter reaches only 100px and reloads every 0.55 s, so it can cross the whole
// coverage window between two shots and leave alive — which is how this item came to report
// "the atom is neutralized" as FAILED against a build that neutralizes it perfectly well
// given a fair pass. Four shells at 44-ish px/s is comfortably four shots inside the window.
const ATOM_ELECTRONS = 4;

const TAIL_TICKS = 60; // 60 ticks = 1 s, so the clip shows the kill and its burst

export default function item() {
  let unitId;
  let cue;

  return {
    id: "audio.neutralize",

    async arrange(api) {
      ({ unitId } = await coverAndPassThrough(api, {
        kind: "emitter",
        type: "atom",
        electrons: ATOM_ELECTRONS,
      }));
      await armAudio(api);
    },

    async act(api) {
      // The event is the unit BEING GONE, not the one-frame `neutralize` burst. A burst can
      // come and go inside a single frame, so a real-time window can sample straight over it
      // and report no kill on a build that killed the unit exactly as asked; a removed unit
      // stays removed and cannot be missed.
      cue = await cueOnImpact(api, unitId, (s) => unitById(s, unitId) == null);
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
