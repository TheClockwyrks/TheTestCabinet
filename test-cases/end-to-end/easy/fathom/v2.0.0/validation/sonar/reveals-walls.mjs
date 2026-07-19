// sonar.reveals-walls: a pulse reveals the corridors it floods and the walls bounding
// them (more revealed walls after the pulse than from passive light alone).
import { startPlaying } from "../_helpers.mjs";

function revealedWalls(s) {
  let n = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      if (s.tiles[r][c] === "#" && (s.visibility[r][c] === "l" || s.visibility[r][c] === "r")) n++;
    }
  }
  return n;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sonar.reveals-walls");
  await startPlaying(api);
  await api.step(0.05); // passive light only
  const before = revealedWalls(await api.snapshot());
  await api.call("clearCooldowns");
  await api.call("press", "Space");
  await api.step(1.0); // let the full pulse flood the corridors
  const after = revealedWalls(await api.snapshot());
  check.expectGt("the sonar pulse reveals additional walls", after, before);
  await api.wait(100);
  await api.screenshot("walls");
  return check.verdict();
}
