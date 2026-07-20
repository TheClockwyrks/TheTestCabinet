// maze.no-dead-ends: every corridor tile has at least two open neighbors.
//
// A structural read of the generated maze: everything judged is already in the snapshot
// `arrange` takes, and `act` only holds still long enough to capture the board.
import { startPlaying, deadEnds } from "../_helpers.mjs";

export default function item() {
  let ends;

  return {
    id: "maze.no-dead-ends",

    async arrange(api) {
      const snap = await startPlaying(api);
      ends = deadEnds(snap).length;
    },

    async act(api) {
      await api.settle(120); // a REAL pause (the old wait(120)) so the board is painted
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectEq(
        "no corridor tile is a dead end (every open tile has >=2 open neighbors)",
        ends,
        0,
      );
    },
  };
}
