// fog.light-reveals-walls: the walls the passive light lands on become revealed rock.
import { startPlaying } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fog.light-reveals-walls");
  await startPlaying(api);
  await api.call("setBrightness", 1); // widen the light so it reaches surrounding walls
  await api.step(0.1);
  const s = await api.snapshot();
  let revealedWalls = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      if (s.tiles[r][c] === "#" && (s.visibility[r][c] === "l" || s.visibility[r][c] === "r")) {
        revealedWalls++;
      }
    }
  }
  check.expectGt("the light reveals the walls it lands on", revealedWalls, 0);
  await api.wait(100);
  await api.screenshot("walls");
  return check.verdict();
}
