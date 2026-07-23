// maze-movement.wrap-tunnel: travelling into the wrap tunnel carries the forager
// continuously out the opposite edge.
//
// Locating the tunnel row and standing on its left end is instant (`arrange`); swimming
// off the edge is the real sim, so it is `act` — the clip is the wrap itself.
import { startPlaying, wrapRow } from "../_helpers.mjs";

export default function item() {
  let wr;
  let cols;
  let after;

  return {
    id: "maze-movement.wrap-tunnel",

    async arrange(api) {
      const snap = await startPlaying(api);
      wr = wrapRow(snap);
      cols = snap.grid.cols;
      if (wr < 0) return;
      await api.call("setForager", { tx: 0, ty: wr });
    },

    async act(api) {
      if (wr < 0) return;
      await api.call("keyDown", "ArrowLeft");
      await api.advance(18); // 18 ticks = the old 0.15 s: step off the left edge into the tunnel
      after = (await api.snapshot()).forager;
      await api.advance(96); // 96 ticks = the old 800 ms live tail, key still held
      await api.call("keyUp", "ArrowLeft");
    },

    async assert(api, check) {
      check.expectOk("the maze has a horizontal wrap tunnel", wr >= 0);
      if (wr < 0) return;
      check.expectGt(
        "moving off the left edge wraps the forager to the right edge",
        after.tx,
        cols - 3,
      );
    },
  };
}
