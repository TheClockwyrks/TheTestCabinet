// maze.openness-mazing: the board reads as corridors and junctions, not an open
// room. Asserts the FAIL lines (too open / no branching) so a valid maze never flakes.
//
// A structural read of the generated maze: everything judged is already in the snapshot
// `arrange` takes, and `act` only holds still long enough to capture the board.
import { startPlaying, avgOpenNeighbors, junctions } from "../_helpers.mjs";

export default function item() {
  let openness;
  let branches;

  return {
    id: "maze.openness-mazing",

    async arrange(api) {
      const snap = await startPlaying(api);
      openness = avgOpenNeighbors(snap);
      branches = junctions(snap).length;
    },

    async act(api) {
      await api.settle(120); // a REAL pause (the old wait(120)) so the board is painted
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectLt(
        "average openness is low (corridors, not an open field)",
        openness,
        3.0,
      );
      check.expectGt(
        "the maze has real branching (junctions exist)",
        branches,
        0,
      );
    },
  };
}
