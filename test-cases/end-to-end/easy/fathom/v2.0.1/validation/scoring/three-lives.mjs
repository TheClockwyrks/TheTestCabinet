// scoring.three-lives: the dive starts with three lives; losing them all ends the game.
//
// The starting life count is read straight off the snapshot `arrange` takes. Spending the
// three lives needs the sim to run a collision each time (and `beginPlay` between them,
// which is a control op and so is legal inside act), so the loop is `act` — the clip is
// the run of catches that ends the game.
import { startPlaying, denAllExcept, START_LIVES } from "../_helpers.mjs";

export default function item() {
  let startLives;
  let finalScreen;

  return {
    id: "scoring.three-lives",

    async arrange(api) {
      const snap = await startPlaying(api);
      startLives = snap.lives;
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
      finalScreen = (await api.snapshot()).screen;
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "the dive starts with three lives",
        startLives,
        START_LIVES,
      );
      check.expectEq("losing all lives ends the game", finalScreen, "gameover");
    },
  };
}
