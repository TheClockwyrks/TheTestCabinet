// maze-movement.no-wall: holding a direction into a wall does not move the forager.
//
// Finding a tile with a wall on one side and standing on it is instant (`arrange`); the
// held key that fails to move the forager is the real sim, so it is `act`. The key stays
// held through the tail so the clip shows the forager pressed against the rock, going
// nowhere — which is the whole point.
import { startPlaying, poseMaze, DIR_KEY } from "../_helpers.mjs";

// A short corridor that ENDS in rock, with the forager parked at `W` against that end.
// Everything outside the art is wall, so the tile east of `W` is the rock this item is
// about. Posed rather than found: which tiles have a wall on which side is a property of
// the maze a build invented, and the direction that happened to be walled decided which
// key this item pressed.
const DEAD_END = ["...W"];

export default function item() {
  let dir;
  let before;
  let after;

  return {
    id: "maze-movement.no-wall",

    async arrange(api) {
      await startPlaying(api);
      const board = await poseMaze(api, DEAD_END);
      dir = "right"; // into the rock that closes the corridor east of `W`
      await api.call("setForager", board.mark("W"));
    },

    async act(api) {
      before = (await api.snapshot()).forager;
      await api.call("keyDown", DIR_KEY[dir]);
      await api.advance(36); // 36 ticks = the old 0.3 s
      after = (await api.snapshot()).forager;
      await api.advance(72); // 72 ticks = the old 600 ms live tail, key still held
      await api.call("keyUp", DIR_KEY[dir]);
    },

    async assert(api, check) {
      check.expectEq(
        "the forager stays on its tile against the wall",
        `${after.tx},${after.ty}`,
        `${before.tx},${before.ty}`,
      );
      check.expectOk(
        "the forager does not enter the wall (not moving)",
        after.moving === false,
      );
    },
  };
}
