// maze.symmetry: the maze is mirror-symmetric about its vertical centerline.
//
// A structural read of the generated maze: everything judged is already in the snapshot
// `arrange` takes, and `act` only holds still long enough to capture the board.
import { startPlaying, symmetryMismatches } from "../_helpers.mjs";

export default function item() {
  let mismatches;

  return {
    id: "maze.symmetry",

    async arrange(api) {
      const snap = await startPlaying(api);
      mismatches = symmetryMismatches(snap);
    },

    async act(api) {
      await api.settle(120); // a REAL pause (the old wait(120)) so the board is painted
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectEq(
        "the maze is mirror-symmetric about its centerline (no wall/floor mismatches)",
        mismatches,
        0,
      );
    },
  };
}
