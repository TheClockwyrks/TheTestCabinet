// maze.corridors-one-wide: no 2x2 block of open corridor exists.
//
// A structural read of the generated maze: everything judged is already in the snapshot
// `arrange` takes, and `act` only holds still long enough to capture the board.
import { startPlaying, count2x2Open } from "../_helpers.mjs";

export default function item() {
  let blocks;

  return {
    id: "maze.corridors-one-wide",

    async arrange(api) {
      const snap = await startPlaying(api);
      blocks = count2x2Open(snap);
    },

    async act(api) {
      await api.settle(120); // a REAL pause (the old wait(120)) so the board is painted
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectEq(
        "no 2x2 block of open corridor (corridors are one tile wide)",
        blocks,
        0,
      );
    },
  };
}
