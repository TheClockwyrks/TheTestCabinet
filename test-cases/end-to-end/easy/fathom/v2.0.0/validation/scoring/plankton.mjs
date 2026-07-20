// scoring.plankton: eating a plankton scores 10 and clears it from the trench.
//
// Standing the forager on a fresh pellet tile is instant (`arrange`); the eat is the real
// sim, so it is `act`.
import {
  startPlaying,
  findOpenWithNeighbor,
  SCORE_PLANKTON,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "scoring.plankton",

    async arrange(api) {
      const snap = await startPlaying(api);
      const spot = findOpenWithNeighbor(snap, "right"); // a fresh corridor tile (carries a plankton)
      await api.call("setForager", { tx: spot.tx, ty: spot.ty });
    },

    async act(api) {
      before = await api.snapshot();
      await api.advance(6); // 6 ticks = the old 0.05 s: the real eat on the forager's tile
      after = await api.snapshot();
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "eating a plankton scores 10",
        after.score - before.score,
        SCORE_PLANKTON,
      );
      check.expectEq(
        "the plankton is cleared from the trench",
        before.planktonRemaining - after.planktonRemaining,
        1,
      );
    },
  };
}
