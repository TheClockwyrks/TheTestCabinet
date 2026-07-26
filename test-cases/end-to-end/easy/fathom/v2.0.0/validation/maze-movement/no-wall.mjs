// maze-movement.no-wall: holding a direction into a wall does not move the forager.
//
// Finding a tile with a wall on one side and standing on it is instant (`arrange`); the
// held key that fails to move the forager is the real sim, so it is `act`. The key stays
// held through the tail so the clip shows the forager pressed against the rock, going
// nowhere — which is the whole point.
import { startPlaying, findOpenWithWall, DIR_KEY } from "../_helpers.mjs";

export default function item() {
  let dir;
  let before;
  let after;

  return {
    id: "maze-movement.no-wall",

    async arrange(api) {
      const snap = await startPlaying(api);
      dir = null;
      let spot = null;
      for (const d of ["up", "right", "down", "left"]) {
        try {
          spot = findOpenWithWall(snap, d);
          dir = d;
          break;
        } catch {
          /* try the next direction */
        }
      }
      if (!dir) throw new Error("no open tile bordered by a wall");
      await api.call("setForager", { tx: spot.tx, ty: spot.ty });
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
