// Automated validation for the Audio item `leak-cue`: a distinct cue plays when a
// unit leaks an exhaust. Audio is read from the Web Audio sources the build starts
// (see `api.audio`). A real Mote is spawned with no defense (the same setup as
// `surge.leak-costs-life`); audio is armed, and letting it walk out an exhaust must
// grow the audio log.

import { newGame, spawn, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let leaked;

  return {
    id: "audio.leak-cue",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 10);
      await spawn(api, "mote", "left");
      await armAudio(api);
    },

    // 1800 ticks = the old 30s cap, polled every 12 ticks (the old 0.2s chunk) — the
    // Mote's walk to the exhaust is the only thing that can drop lives.
    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.lives < 10, { max: 1800, poll: 12 });
      after = await audioCount(api);
      leaked = r.hit;
      await api.advance(30); // a short tail so the clip shows the leak
    },

    async assert(api, check) {
      check.expectOk("the Mote leaks an exhaust", leaked);
      check.expectGt(
        "a cue plays when a unit leaks (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
