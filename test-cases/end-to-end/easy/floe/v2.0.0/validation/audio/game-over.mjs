// Automated validation for the Audio item `game-over`: the Game-over sting plays when
// the last life is lost. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). Lives are set to one and the critter is left safe on the median while
// the crossing timer is driven to zero — a timeout death, which itself plays no cue, so
// the only cue that can fire is the Game-over sting once the run ends. The audio log
// must grow across reaching the game-over screen.

import {
  startCrossing,
  armAudio,
  audioCount,
  ROW_MEDIAN,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let ended;

  return {
    id: "audio.game-over",

    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 1); // the next death ends the run
      await api.call("placeCritter", 20, ROW_MEDIAN); // safe, solid tile
      await api.call("setTimer", 0.05); // about to run out
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.screen === "gameover", {
        max: 360,
        poll: 2,
      });
      after = await audioCount(api);
      ended = r.hit;
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectOk("losing the last life reaches game over", ended);
      check.expectGt(
        "the Game-over sting plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
