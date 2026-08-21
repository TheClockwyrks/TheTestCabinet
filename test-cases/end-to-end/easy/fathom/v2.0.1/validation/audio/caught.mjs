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
  let inPlay;
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
      // THE CATCH HAS TO STILL BE AHEAD OF US. `until` reports a hit the moment its
      // predicate holds, including on the very first read — so on a board that had already
      // left live play this would report a catch it never saw, and then read a log already
      // carrying the cue for it. A build that keeps simulating between driver calls
      // (`controls/manual-clock`) does exactly that: one took the life during `arrange`,
      // before the audio log was even armed, and this item recorded a vacuous "a predator
      // catches the forager" beside a cue count that never moved.
      inPlay = (await api.snapshot()).screen === "playing";
      const r = await api.until((s) => s.screen !== "playing", {
        max: 30,
        poll: 2,
      });
      after = await audioCount(api);
      caught = r.hit;
      await api.advance(30); // a short tail so the clip shows the catch
    },

    async assert(api, check) {
      check.expectOk(
        "the dive is still in live play when the catch is staged, so the cue counted is this catch's",
        inPlay,
      );
      if (!inPlay) return;
      check.expectOk("a predator catches the forager", caught);
      check.expectGt(
        "a caught cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
