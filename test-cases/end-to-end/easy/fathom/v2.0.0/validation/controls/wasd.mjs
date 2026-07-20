// controls.wasd: W/A/S/D move the forager up/left/down/right like the arrows.
//
// The old script restarted the dive before each of the four keys. `act` cannot do that —
// `reset` would take the clock back mid-phase and freeze the recording — and it does not
// need to: `setForager` re-poses the forager on the next direction's tile without
// touching the clock, which is exactly what the restart was for. All four tiles are
// located up front from the one maze `arrange` reads, so both passes drive the same
// four moves in the same order, and the clip is the forager swimming each of them.
import {
  startPlaying,
  findOpenWithNeighbor,
  movedAlong,
} from "../_helpers.mjs";

const MAP = [
  ["KeyW", "up"],
  ["KeyA", "left"],
  ["KeyS", "down"],
  ["KeyD", "right"],
];

export default function item() {
  // One { code, dir, tx, ty } per key, located in arrange; and the before/after forager
  // states act captured for each.
  let plan;
  const results = [];

  return {
    id: "controls.wasd",

    async arrange(api) {
      const snap = await startPlaying(api);
      plan = MAP.map(([code, dir]) => {
        const spot = findOpenWithNeighbor(snap, dir);
        return { code, dir, tx: spot.tx, ty: spot.ty };
      });
    },

    async act(api) {
      for (const { code, dir, tx, ty } of plan) {
        await api.call("setForager", { tx, ty });
        const before = (await api.snapshot()).forager;
        await api.call("keyDown", code);
        await api.advance(30); // 30 ticks = the old 0.25 s, ~one tile at 128 px/s
        const after = (await api.snapshot()).forager;
        await api.call("keyUp", code);
        results.push({ code, dir, before, after });
      }
    },

    async assert(api, check) {
      for (const { code, dir, before, after } of results) {
        check.expectOk(
          `${code} moves the forager ${dir}`,
          movedAlong(before, after, dir) && after.dir === dir,
        );
      }
    },
  };
}
