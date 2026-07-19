// fog.remembered-persists: a revealed tile stays remembered after the forager moves
// away (it becomes 'r', not 'u').
import { startPlaying, openTiles, clip } from "../_helpers.mjs";

const man = (a, b, c, d) => Math.abs(a - c) + Math.abs(b - d);

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fog.remembered-persists");
  const snap = await startPlaying(api);
  await api.step(0.1); // light and reveal the forager's pocket
  const s = await api.snapshot();
  // A currently-lit corridor tile to watch.
  let target = null;
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
  await api.step(0.1);
  const s2 = await api.snapshot();
  check.expectEq(
    "the revealed tile is remembered after the forager moves away",
    s2.visibility[target.r][target.c],
    "r",
  );
  await clip(api, 700);
  return check.verdict();
}
