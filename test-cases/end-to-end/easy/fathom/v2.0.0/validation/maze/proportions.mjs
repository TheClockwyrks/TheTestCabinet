// maze.proportions: the board reads as corridors and its corridor proportions fall
// inside the hard ranges the spec fixes (specs/maze.md). Three metrics, computed over
// the corridor tiles (the open floor the forager can enter, excluding the den and gate):
//
//   * openness — mean open neighbors per corridor tile. Kept low so the board is
//     corridors, not rooms (above ~2.8 it reads as open space).
//   * mazing — mean corridor run length. Kept off the floor so the board is not a dense
//     grid (a junction at nearly every tile) and off the ceiling so it is not sparse
//     hallways with few choices.
//   * density — corridor share of the interior. Kept high enough that the maze fills the
//     grid rather than being a few thin paths.
//
// These are also the properties that GUARANTEE the wall occlusion the sensing checks
// (light is line-of-sight; a predator behind rock is not lit or sensed) depend on: a
// dense, one-wide, non-room board necessarily runs corridors close enough that some are
// hidden from each other behind rock. So this item is what lets those checks treat a
// missing occluded pair as the build's fault (see findOccludedPair in _helpers.mjs).
//
// A structural read of the generated maze: everything judged is already in the snapshot
// `arrange` takes, and `act` only holds still long enough to capture the board.
import {
  startPlaying,
  mazeProportions,
  MAZE_OPENNESS_MAX,
  MAZE_MAZING_MIN,
  MAZE_MAZING_MAX,
  MAZE_DENSITY_MIN,
} from "../_helpers.mjs";

export default function item() {
  let p;

  return {
    id: "maze.proportions",

    async arrange(api) {
      const snap = await startPlaying(api);
      p = mazeProportions(snap);
    },

    async act(api) {
      await api.settle(120); // a REAL pause so the board is painted
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectLe(
        "openness is low — corridors, not rooms",
        p.openness,
        MAZE_OPENNESS_MAX,
      );
      check.expectGe(
        "mean corridor length is off the floor — not a dense grid",
        p.mazing,
        MAZE_MAZING_MIN,
      );
      check.expectLe(
        "mean corridor length is off the ceiling — not sparse hallways",
        p.mazing,
        MAZE_MAZING_MAX,
      );
      check.expectGe(
        "corridor density fills the grid — a substantial maze, not a few paths",
        p.density,
        MAZE_DENSITY_MIN,
      );
    },
  };
}
