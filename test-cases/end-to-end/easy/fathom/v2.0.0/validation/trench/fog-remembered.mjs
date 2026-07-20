// trench.fog-remembered: in the Trench dive the whole explored map stays drawn — ground
// far from the forager that was revealed is still shown (no vision-circle blackout).
import { startPlaying, openTiles, tileCenter, sampleColor, luminance } from "../_helpers.mjs";

const man = (a, b, c, d) => Math.abs(a - c) + Math.abs(b - d);

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trench.fog-remembered");
  const snap = await startPlaying(api);
  await api.step(0.1); // reveal the forager's pocket
  const s = await api.snapshot();
  let target = null;
  for (let r = 0; r < s.grid.rows && !target; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      if (s.tiles[r][c] === "." && (s.visibility[r][c] === "l" || s.visibility[r][c] === "r")) {
        target = { c, r };
        break;
      }
    }
  }
  if (!target) throw new Error("no revealed corridor tile");

  const far = openTiles(s).find(([c, r]) => man(c, r, target.c, target.r) > 10);
  if (!far) throw new Error("no far tile to move to");
  await api.call("setForager", { tx: far[0], ty: far[1] });
  await api.step(0.1);
  const s2 = await api.snapshot();
  check.expectEq("the far tile is still remembered", s2.visibility[target.r][target.c], "r");

  await api.wait(120);
  const p = tileCenter(s2.grid, target.c, target.r);
  const col = await sampleColor(api, p.x, p.y);
  const fogTile = openTiles(s2).find(
    ([c, r]) => s2.visibility[r][c] === "u" && man(c, r, s2.forager.tx, s2.forager.ty) > 4,
  );
  const fogCol = fogTile
    ? await sampleColor(api, tileCenter(s2.grid, fogTile[0], fogTile[1]).x, tileCenter(s2.grid, fogTile[0], fogTile[1]).y)
    : { r: 3, g: 6, b: 12 };
  check.expectGt(
    "the remembered ground is still drawn far from the forager (brighter than fog)",
    luminance(col),
    luminance(fogCol) + 6,
  );
  await api.screenshot("remembered");
  return check.verdict();
}
