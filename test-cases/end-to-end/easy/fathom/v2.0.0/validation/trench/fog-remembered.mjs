// trench.fog-remembered: in the Trench dive the whole explored map stays drawn — ground
// far from the forager that was revealed is still shown (no vision-circle blackout).
//
// The tile to watch is whichever one the light has actually reached, so it cannot be
// chosen until the pocket has been lit — which takes sim time. That makes the whole
// sequence `act`: light the pocket, pick a revealed tile, move the forager far away with
// a control op (`setForager`; `reset` in act would freeze the recording), and sample what
// is still drawn there.
import {
  startPlaying,
  openTiles,
  tileCenter,
  sampleColor,
  luminance,
} from "../_helpers.mjs";

const man = (a, b, c, d) => Math.abs(a - c) + Math.abs(b - d);

export default function item() {
  let remembered;
  let col;
  let fogCol;

  return {
    id: "trench.fog-remembered",

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      await api.advance(12); // 12 ticks = the old 0.1 s: reveal the forager's pocket
      const s = await api.snapshot();
      let target = null;
      for (let r = 0; r < s.grid.rows && !target; r++) {
        for (let c = 0; c < s.grid.cols; c++) {
          if (
            s.tiles[r][c] === "." &&
            (s.visibility[r][c] === "l" || s.visibility[r][c] === "r")
          ) {
            target = { c, r };
            break;
          }
        }
      }
      if (!target) throw new Error("no revealed corridor tile");

      const far = openTiles(s).find(
        ([c, r]) => man(c, r, target.c, target.r) > 10,
      );
      if (!far) throw new Error("no far tile to move to");
      await api.call("setForager", { tx: far[0], ty: far[1] });
      await api.advance(12); // 12 ticks = the old 0.1 s
      const s2 = await api.snapshot();
      remembered = s2.visibility[target.r][target.c];

      // A REAL pause (the old wait(120)) so the remembered ground has been painted.
      await api.settle(120);
      const p = tileCenter(s2.grid, target.c, target.r);
      col = await sampleColor(api, p.x, p.y);
      const fogTile = openTiles(s2).find(
        ([c, r]) =>
          s2.visibility[r][c] === "u" &&
          man(c, r, s2.forager.tx, s2.forager.ty) > 4,
      );
      fogCol = fogTile
        ? await sampleColor(
            api,
            tileCenter(s2.grid, fogTile[0], fogTile[1]).x,
            tileCenter(s2.grid, fogTile[0], fogTile[1]).y,
          )
        : { r: 3, g: 6, b: 12 };
      await api.screenshot("remembered");
    },

    async assert(api, check) {
      check.expectEq("the far tile is still remembered", remembered, "r");
      check.expectGt(
        "the remembered ground is still drawn far from the forager (brighter than fog)",
        luminance(col),
        luminance(fogCol) + 6,
      );
    },
  };
}
