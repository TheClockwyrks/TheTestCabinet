// amber.drifter-score: eating a bonus drifter scores 200.
//
// Entering play and clearing the board is instant (`arrange`); the drifter is spawned on
// the forager's own tile and the eat then happens in the real sim, so both live in `act`
// — the clip shows the drifter actually being taken.
import { startPlaying, SCORE_DRIFTER } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "amber.drifter-score",

    async arrange(api) {
      await startPlaying(api);
      await api.call("poseLastPlankton"); // clear plankton so only the drifter scores here
    },

    async act(api) {
      const f = (await api.snapshot()).forager;
      before = (await api.snapshot()).score;
      await api.call("spawnDrifter", { tx: f.tx, ty: f.ty }); // on the forager's tile
      await api.advance(6); // 6 ticks = the old 0.05 s: the real eat
      after = await api.snapshot();
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "eating a drifter scores 200",
        after.score - before,
        SCORE_DRIFTER,
      );
    },
  };
}
