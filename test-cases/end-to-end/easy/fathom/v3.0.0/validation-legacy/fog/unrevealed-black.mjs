// fog.unrevealed-black: an untouched tile is flat black fog (unrevealed + near-black).
//
// Which tiles are still untouched is only known once the pocket has been lit, which takes
// sim time — so lighting it, picking a far unrevealed tile and sampling what was drawn
// there are all `act`.
import {
  startPlaying,
  openTiles,
  tileCenter,
  sampleColor,
  isDark,
} from "../_helpers.mjs";

export default function item() {
  let visibility;
  let col;

  return {
    id: "fog.unrevealed-black",

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      await api.advance(12); // 12 ticks = the old 0.1 s: light the forager's pocket, leaving the rest as fog
      const s = await api.snapshot();
      const f = s.forager;
      const far = openTiles(s).find(
        ([c, r]) =>
          s.visibility[r][c] === "u" &&
          Math.abs(c - f.tx) + Math.abs(r - f.ty) > 6,
      );
      if (!far) throw new Error("no far unrevealed tile found");
      const [c, r] = far;
      visibility = s.visibility[r][c];
      const p = tileCenter(s.grid, c, r);
      // The old script sampled straight after its step and got away with it on the
      // incidental latency of the driver round trip. Under the two-pass runtime the
      // validate pass advances instantly and paints NO frame, so a canvas read needs a
      // real settle first or it races the renderer; 120 ms matches the settle every
      // other sampling item in this case uses.
      await api.settle(120);
      col = await sampleColor(api, p.x, p.y);
      await api.screenshot("fog");
    },

    async assert(api, check) {
      check.expectEq("a far untouched tile is unrevealed", visibility, "u");
      check.expectOk(
        "the unrevealed tile renders as near-black fog",
        isDark(col),
      );
    },
  };
}
