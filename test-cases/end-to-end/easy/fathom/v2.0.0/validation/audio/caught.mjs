// Automated validation for the Audio item `caught`: a cue plays when a predator catches
// the forager. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). Every other predator is denned, a chasing Gloamfin is dropped onto the
// forager's own tile (see scoring/caught-costs-life.mjs), audio is armed, and the real
// collision check is stepped so contact costs a life; the audio log must grow across it.
// Lives stay at the fresh-run default so the catch resets the dive rather than ending
// the run, isolating the caught cue from any later game-over handling.

import {
  startPlaying,
  denAllExcept,
  armAudio,
  audioCount,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let caught;

  return {
    id: "audio.caught",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      const f = snap.forager;
      await api.call("setPredator", "gloamfin", {
        tx: f.tx,
        ty: f.ty,
        mode: "chase",
      });
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.screen !== "playing", {
        max: 30,
        poll: 2,
      });
      after = await audioCount(api);
      caught = r.hit;
      await api.advance(30); // a short tail so the clip shows the catch
    },

    async assert(api, check) {
      check.expectOk("a predator catches the forager", caught);
      check.expectGt(
        "a caught cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
