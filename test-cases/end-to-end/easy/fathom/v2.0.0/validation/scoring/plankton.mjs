// scoring.plankton: eating a plankton scores 10 and clears it from the maze.
//
// The forager is stood at the head of a corridor with pellets ahead of it in `arrange`;
// the eat it swims into is the real sim, so it is `act` — the clip shows the forager
// take the pellet and the score tick over, rather than opening on a score that has
// already changed. See `arrangeGraze` / `actGrazeOne`.
import { arrangeGraze, actGrazeOne, SCORE_PLANKTON } from "../_helpers.mjs";

export default function item() {
  let run;
  let graze;

  return {
    id: "scoring.plankton",

    async arrange(api) {
      ({ run } = await arrangeGraze(api));
    },

    async act(api) {
      graze = await actGrazeOne(api, run.dir);
    },

    async assert(api, check) {
      check.expectOk("the forager swam into a plankton", graze.hit);
      if (!graze.hit) return;
      check.expectEq(
        "eating a plankton scores 10",
        graze.after.score - graze.before.score,
        SCORE_PLANKTON,
      );
      check.expectEq(
        "the plankton is cleared from the maze",
        graze.before.planktonRemaining - graze.after.planktonRemaining,
        1,
      );
    },
  };
}
