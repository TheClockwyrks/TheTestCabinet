// maze-movement.wrap-tunnel: travelling into the wrap tunnel carries the forager
// continuously out the opposite edge.
//
// Locating the tunnel row and standing on its left end is instant (`arrange`); swimming
// off the edge is the real sim, so it is `act` — the clip is the wrap itself.
//
// WHY THIS WAITS RATHER THAN SAMPLING. An earlier form advanced a flat 18 ticks (19.2 px
// at 128 px/s) and then asserted the forager had already come out the far side. That
// pinned the check to one particular seam: the forager starts half a tile (16 px) inside
// the border, so 18 ticks left barely 3 px of slack, and a build that hands over a few
// pixels later failed while wrapping perfectly well. The spec fixes the TOPOLOGY (the two
// mouths are one corridor, and nothing stops at the edge), not the pixel the swap happens
// on, so this waits for the crossing over a budget big enough for any sane seam and
// checks the properties the spec does name.
import { startPlaying, wrapRow, FORAGER_SPEED, TICK_HZ } from "../_helpers.mjs";

// Two full tiles of travel — far more than the distance between the two mouths, whichever
// side of the border a build hands over on.
const CROSSING_BUDGET = 72; // ticks = 0.6 s = 76.8 px at 128 px/s

// How far outside the maze frame the forager's center may stray while crossing. The
// border is where the two mouths meet, so a wrap should not park the forager out in the
// margin; a few sim steps of overshoot is slack for the fixed timestep, not a design.
const EDGE_SLACK = (4 * FORAGER_SPEED) / TICK_HZ; // 4 steps ≈ 4.3 px

export default function item() {
  let wr;
  let grid;
  let wrapped = false;
  let after;
  let stopped = false;
  let strayed = 0;

  return {
    id: "maze-movement.wrap-tunnel",

    async arrange(api) {
      const snap = await startPlaying(api);
      wr = wrapRow(snap);
      grid = snap.grid;
      if (wr < 0) return;
      await api.call("setForager", { tx: 0, ty: wr, dir: "left" });
    },

    async act(api) {
      if (wr < 0) return;
      const left = grid.originX;
      const right = grid.originX + grid.cols * grid.tile;
      await api.call("keyDown", "ArrowLeft");
      for (let i = 0; i < CROSSING_BUDGET; i++) {
        await api.advance(1);
        const f = (await api.snapshot()).forager;
        // "Movement and speed are continuous through the wrap; nothing stops at the
        // edge" (specs/maze.md).
        if (f.moving === false) stopped = true;
        strayed = Math.max(strayed, left - f.x, f.x - right);
        if (f.tx > grid.cols - 3) {
          wrapped = true;
          after = f;
          break;
        }
      }
      await api.call("keyUp", "ArrowLeft");
      await api.advance(96); // 96 ticks of the key still held, for the clip
    },

    async assert(api, check) {
      check.expectOk("the maze has a horizontal wrap tunnel", wr >= 0);
      if (wr < 0) return;
      check.expectOk(
        "swimming off the left edge carries the forager to the right edge",
        wrapped,
      );
      if (!wrapped) return;
      check.expectEq("it comes out on the same row", after.ty, wr);
      check.expectOk("nothing stops at the edge", stopped === false);
      check.expectLe(
        "the forager stays within the maze frame as it crosses",
        strayed,
        EDGE_SLACK,
      );
    },
  };
}
