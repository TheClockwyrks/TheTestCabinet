// scoring.cleared-bonus: eating the last plankton clears the maze for a 500 bonus.
//
// Posing the single remaining plankton next to the forager is instant (`arrange`);
// swimming onto it is the real sim, so it is `act` — the clip is the last pellet being
// taken and the maze clearing.
//
// Which neighbor `poseLastPlankton` chose is the build's own call and is not reported by
// `snapshot`, so `actEatLastPlankton` tries each open neighbor rather than assuming one
// (see its note in ../_helpers.mjs).
import { startPlaying, actEatLastPlankton, SCORE_CLEAR } from "../_helpers.mjs";

export default function item() {
  let before;
  let r;

  return {
    id: "scoring.cleared-bonus",

    async arrange(api) {
      await startPlaying(api);
      await api.call("poseLastPlankton");
    },

    async act(api) {
      before = (await api.snapshot()).score;
      r = await actEatLastPlankton(api);
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "eating the last plankton clears the maze",
        r.snap.screen,
        "cleared",
      );
      check.expectGe(
        "clearing awards the 500 bonus",
        r.snap.score - before,
        SCORE_CLEAR,
      );
    },
  };
}
