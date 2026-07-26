// Automated validation for the Audio item `victory-cue`: the Victory sting plays
// when the final wave clears and the run is won. Audio is read from the Web Audio
// sources the build starts (see `api.audio`). We jump to the final wave with a huge
// life reserve and start it (the same setup as `states.victory`); audio is armed,
// and letting the whole wave resolve to a clear — which the real clear-wave code
// turns into Victory — must grow the audio log.

import { newGame, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let won;

  return {
    id: "audio.victory-cue",

    // The final wave takes ~35s of real time to run itself out — far past the 8s
    // default record budget, so the record pass would unwind before the tail
    // advance ever ran. This lengthens only the record pass, not the verdict (the
    // validate pass steps instantly).
    clipMs: 60000,

    // The final wave, with lives deep enough that the whole wave leaking past cannot
    // end the run before it is cleared.
    async arrange(api) {
      const s0 = await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000000); // survive the whole final wave leaking past
      await api.call("setWave", s0.waveCount); // the final wave
      await api.call("startWave");
      await armAudio(api);
    },

    // 13200 ticks = the old 220s cap, polled every 30 ticks (the old 0.5s chunk) —
    // the screen only changes once, at the win, so a coarse sweep keeps this long
    // drive cheap.
    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.screen === "victory", {
        max: 13200,
        poll: 30,
      });
      after = await audioCount(api);
      won = r.hit;
      await api.advance(30); // a short tail so the clip shows the win
    },

    async assert(api, check) {
      check.expectOk("clearing the final wave reaches Victory", won);
      check.expectGt(
        "the Victory sting plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
