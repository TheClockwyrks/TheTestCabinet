// states.gameover: losing the last life reaches the game-over screen.
//
// Spending every life needs the sim to run a collision each time (and `beginPlay` between
// them, which is a control op and so is legal inside act), so the loop is `act`; the
// capture at the end is the game-over screen.
import { startPlaying, denAllExcept } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.gameover",

    async arrange(api) {
      await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
    },

    async act(api) {
      for (let i = 0; i < 8; i++) {
        let s = await api.snapshot();
        if (s.screen === "gameover") break;
        if (s.screen === "countdown") {
          await api.call("beginPlay");
          s = await api.snapshot();
        }
        if (s.screen !== "playing") break;
        const f = s.forager;
        await api.call("setPredator", "gloamfin", {
          tx: f.tx,
          ty: f.ty,
          mode: "chase",
        });
        await api.advance(6); // 6 ticks = the old 0.05 s
      }
      screen = (await api.snapshot()).screen;
      await api.settle(150); // a REAL pause (the old wait(150)) so the still is painted
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectEq(
        "losing the last life reaches game over",
        screen,
        "gameover",
      );
    },
  };
}
