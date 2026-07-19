// sonar.near-before-far: the wavefront reveals nearer tiles before farther ones, so
// the revealed set grows as the front advances rather than appearing all at once.
import { startPlaying, clip } from "../_helpers.mjs";

function revealedCount(s) {
  let n = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      const v = s.visibility[r][c];
      if (v === "l" || v === "r") n++;
    }
  }
  return n;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sonar.near-before-far");
  await startPlaying(api);
  await api.call("clearCooldowns");
  await api.call("press", "Space");
  await api.step(0.12);
  const early = revealedCount(await api.snapshot());
  await api.step(0.6);
  const late = revealedCount(await api.snapshot());
  check.expectGt(
    "more tiles are revealed as the front advances (near revealed before far)",
    late,
    early,
  );
  await clip(api, 900);
  return check.verdict();
}
