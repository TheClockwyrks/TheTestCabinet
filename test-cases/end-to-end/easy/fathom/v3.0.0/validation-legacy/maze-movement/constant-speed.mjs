// maze-movement.constant-speed: the forager travels corridors at ~128 px/s.
//
// The straight run is posed instantly (`arrange`); the measured half-second of held input
// is the real sim, so it is `act`. The key stays held through the tail so the clip shows
// the forager still swimming rather than stopping the moment the reading was taken.
import { startPlaying, poseMaze, DIR_KEY } from "../_helpers.mjs";

// A straight corridor to swim, with the forager starting at `S`. Eight tiles is the
// half-second measured below (two tiles at `128 px/s`) plus the `0.9 s` tail the clip
// runs on, with room to spare, so the forager never reaches the end and the reading is
// of a forager swimming rather than one that ran out of corridor. `specs/maze.md` fixes
// no run length, so posing the run is the only way to know there is one.
const CORRIDOR = ["S........."];

export default function item() {
  let run;
  let dist;

  return {
    id: "maze-movement.constant-speed",

    async arrange(api) {
      await startPlaying(api);
      const board = await poseMaze(api, CORRIDOR);
      run = { ...board.mark("S"), dir: "right" };
      await api.call("setForager", { tx: run.tx, ty: run.ty });
    },

    async act(api) {
      const before = (await api.snapshot()).forager;
      await api.call("keyDown", DIR_KEY[run.dir]);
      // 60 ticks = the old 0.5 s. 128 px/s * 0.5 s = 64 px expected, and on the manual
      // clock a whole-tick advance makes that exact.
      await api.advance(60);
      const after = (await api.snapshot()).forager;
      dist = Math.hypot(after.x - before.x, after.y - before.y);
      await api.advance(108); // 108 ticks = the old 900 ms live tail, key still held
      await api.call("keyUp", DIR_KEY[run.dir]);
    },

    async assert(api, check) {
      check.expectClose(
        "the forager covers ~64 px in 0.5 s along a corridor (128 px/s)",
        dist,
        64,
        8,
      );
    },
  };
}
