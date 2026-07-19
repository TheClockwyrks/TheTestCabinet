// kindle.memory-windowed: ground outside the vision circle is only hidden, not
// forgotten — the fog memory still holds it, and returning draws it again.
import { startPlaying, findStraightRun, openTiles, tileCenter, stepTile, isOpen, sampleColor, luminance, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("kindle.memory-windowed");
  const snap = await startPlaying(api);
  // Stand on a long straight corridor and clear the board so the forager cannot eat
  // (the vision circle stays at rest) and a single pulse reveals tiles straight down
  // the corridor well past the vision circle.
  const run = findStraightRun(snap, 9);
  await api.call("setForager", { tx: run.tx, ty: run.ty, dir: run.dir });
  await api.call("poseLastPlankton");
  await api.call("clearCooldowns");
  await api.call("press", "Space");
  await api.step(1.0); // reveal corridors past the vision circle
  const s = await api.snapshot();
  const R = s.windowRadius;
  const f = s.forager;
  const dist = (c, r) => {
    const p = tileCenter(s.grid, c, r);
    return Math.hypot(p.x - f.x, p.y - f.y);
  };
  // A revealed tile beyond the circle that has an open neighbor to stand on.
  let beyond = null;
  let place = null;
  for (const [c, r] of openTiles(s)) {
    if (s.visibility[r][c] === "u") continue;
    const d = dist(c, r);
    if (d <= R * 1.2 || d >= 300) continue;
    for (const dir of ["up", "down", "left", "right"]) {
      const [nc, nr] = stepTile(s, c, r, dir);
      if (isOpen(s.tiles, nc, nr)) {
        beyond = { c, r };
        place = { tx: nc, ty: nr };
        break;
      }
    }
    if (beyond) break;
  }
  check.expectOk("found a revealed tile beyond the circle", Boolean(beyond));
  if (!beyond) return check.verdict();
  check.expectNe("it is still remembered underneath (not forgotten)", s.visibility[beyond.r][beyond.c], "u");
  await api.wait(120);
  const p = tileCenter(s.grid, beyond.c, beyond.r);
  const colBefore = await sampleColor(api, p.x, p.y);

  await api.call("setForager", { tx: place.tx, ty: place.ty }); // return near it
  await api.step(0.05);
  await api.wait(120);
  const colAfter = await sampleColor(api, p.x, p.y);
  check.expectGt("returning redraws the remembered ground", luminance(colAfter), luminance(colBefore) + 8);
  await clip(api, 800);
  return check.verdict();
}
