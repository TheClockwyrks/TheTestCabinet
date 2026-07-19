// fog.unrevealed-black: an untouched tile is flat black fog (unrevealed + near-black).
import {
  startPlaying,
  openTiles,
  tileCenter,
  sampleColor,
  isDark,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fog.unrevealed-black");
  const snap = await startPlaying(api);
  await api.step(0.1); // light the forager's pocket, leaving the rest as fog
  const s = await api.snapshot();
  const f = s.forager;
  const far = openTiles(s).find(
    ([c, r]) =>
      s.visibility[r][c] === "u" &&
      Math.abs(c - f.tx) + Math.abs(r - f.ty) > 6,
  );
  if (!far) throw new Error("no far unrevealed tile found");
  const [c, r] = far;
  check.expectEq("a far untouched tile is unrevealed", s.visibility[r][c], "u");
  const p = tileCenter(s.grid, c, r);
  const col = await sampleColor(api, p.x, p.y);
  check.expectOk("the unrevealed tile renders as near-black fog", isDark(col));
  await api.screenshot("fog");
  return check.verdict();
}
