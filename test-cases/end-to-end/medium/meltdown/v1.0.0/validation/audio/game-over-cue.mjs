// Automated validation for the Audio item `game-over-cue`: the Game-over sting
// plays when the last life is lost. Audio is read from the Web Audio sources the
// build starts (see `api.audio`). With one life and no defense, a real Mote leaks
// and ends the run (the same setup as `states.gameover`); audio is armed, and the
// real game-over transition must grow the audio log.

import { newGame, spawn, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let ended;

  return {
    id: "audio.game-over-cue",

    // The Mote's walk across the floor to its leak takes ~15s of real time — past
    // the 8s default record budget, so the record pass would unwind before the tail
    // advance ever ran. This lengthens only the record pass, not the verdict.
    clipMs: 30000,

    // One life and no towers, so the first leak is the last.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 1);
      await spawn(api, "mote", "left");
      await armAudio(api);
    },

    // 1800 ticks = the old 30s cap, polled every 12 ticks (the old 0.2s chunk) — the
    // screen only changes at the leak.
    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.screen === "gameover", {
        max: 1800,
        poll: 12,
      });
      after = await audioCount(api);
      ended = r.hit;
      await api.advance(30); // a short tail so the clip shows the loss
    },

    async assert(api, check) {
      check.expectOk("the last-life leak ends the run", ended);
      check.expectGt(
        "the Game-over sting plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
