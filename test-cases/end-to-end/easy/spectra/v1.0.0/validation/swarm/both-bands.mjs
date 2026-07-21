// Automated validation for the Swarm sub-item `both-bands`.
//
// The assembled formation holds drones of both bands — at least one cyan and one
// magenta — so clearing it forces flipping. A real stage is assembled by advancing
// the real entrance systems, and the formation's bands are read from snapshot().

import { startStageClean } from "../_helpers.mjs";

const ASSEMBLE_TICKS = 960; // 960 ticks = the old 8 s for the whole formation to assemble

export default function item() {
  // The assembled field.
  let snap;

  return {
    // The assembly alone is 8 s, which is exactly the default clip budget — the
    // record pass would be cut off at the very moment the formation completes, and
    // the screenshot below (the reviewer's proof, and the only image this item
    // produces) would never be taken. 12 s leaves room for the capture. The validate
    // pass is uncapped, so no verdict depends on this.
    clipMs: 12000,

    id: "swarm.both-bands",

    // A real stage-1 wave with the wave the game builds — the composition of the
    // formation is the thing under test, so nothing may be posed by hand.
    async arrange(api) {
      await startStageClean(api, 1, { clear: false });
    },

    // The fly-in and assembly IS the clip, and the assembled formation is what the
    // assertions read and what the capture shows.
    async act(api) {
      await api.advance(ASSEMBLE_TICKS); // let the whole formation assemble
      snap = await api.snapshot();

      await api.settle(120); // let a frame paint the assembled formation
      await api.screenshot("formation");
    },

    async assert(api, check) {
      const formed = snap.drones.filter((d) => d.phase === "formation");
      const cyan = formed.filter((d) => d.band === "cyan").length;
      const magenta = formed.filter((d) => d.band === "magenta").length;
      check.expectGt("the formation holds at least one cyan drone", cyan, 0);
      check.expectGt(
        "the formation holds at least one magenta drone",
        magenta,
        0,
      );
    },
  };
}
