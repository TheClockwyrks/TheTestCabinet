// Automated validation for the Tower Art sub-item `projectiles-travel`.
//
// A shot is a visible projectile that travels across the board over time before it lands,
// rather than an instantaneous hitscan. The check fires a slow Cleaver shot, confirms the
// projectile carries a travel velocity, then steps a fraction and confirms it moved while
// still in flight.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("tower-art.projectiles-travel");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.2;
  await placeCovering(api, "cleaver", g, s0);
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 + 30 });

  const r = await stepUntil(api, (s) => s.projectiles.length > 0, 2, 0.02);
  check.expectOk("a shot is fired", r.hit);
  const p0 = r.snap.projectiles[0];
  check.expectGt("the projectile has a travel velocity (not hitscan)", Math.hypot(p0.vx, p0.vy), 1);

  const before = { x: p0.x, y: p0.y };
  await api.step(0.03);
  const after = (await api.snapshot()).projectiles.find((p) => p.id === p0.id);
  check.expectOk("the projectile is still in flight after a step", after != null);
  check.expectGt("the projectile moved across the board", Math.hypot(after.x - before.x, after.y - before.y), 1);

  await liveClip(api, 1200);
  return check.verdict();
}
