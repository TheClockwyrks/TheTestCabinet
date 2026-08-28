// fog.remembered-persists: a revealed tile stays remembered after the forager moves
// away (it becomes 'r', not 'u').
//
// The tile to watch is whichever one the light has actually reached, so it cannot be
// chosen until the pocket has been lit — which takes sim time. That makes the whole
// sequence `act`: light the pocket, pick the lit tile, move the forager off it with a
// control op (`setForager`, not `reset` — reset in act would freeze the recording), and
// read the memory back.
import { startPlaying, openTiles } from "../_helpers.mjs";

const man = (a, b, c, d) => Math.abs(a - c) + Math.abs(b - d);

export default function item() {
  let target;
  let remembered;

  return {
    id: "fog.remembered-persists",

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      await api.advance(12); // 12 ticks = the old 0.1 s: light and reveal the forager's pocket
      const s = await api.snapshot();
      // A currently-lit corridor tile to watch.
      target = null;
      for (let r = 0; r < s.grid.rows && !target; r++) {
        for (let c = 0; c < s.grid.cols; c++) {
          if (s.tiles[r][c] === "." && s.visibility[r][c] === "l") {
            target = { c, r };
            break;
          }
        }
      }
      if (!target) throw new Error("no lit corridor tile to watch");

      // Move the forager well away so the light leaves the watched tile.
      const far = openTiles(s).find(
        ([c, r]) => man(c, r, target.c, target.r) > 8,
      );
      if (!far) throw new Error("no far tile to move to");
      await api.call("setForager", { tx: far[0], ty: far[1] });
      await api.advance(12); // 12 ticks = the old 0.1 s
      const s2 = await api.snapshot();
      remembered = s2.visibility[target.r][target.c];

      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "the revealed tile is remembered after the forager moves away",
        remembered,
        "r",
      );
    },
  };
}
