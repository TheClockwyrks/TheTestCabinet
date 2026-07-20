// kindle.beyond-circle: the amber lights are clipped to the vision circle — a drifter
// beyond it does not show (unlike the Trench dive).
import { startPlaying, denAllExcept, findFarTile, sampleColor, isDark } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("kindle.beyond-circle");
  const snap = await startPlaying(api);
  await denAllExcept(api, []);
  const far = findFarTile(snap, snap.forager, 9); // beyond the vision circle
  await api.call("spawnDrifter", { tx: far.tx, ty: far.ty });
  await api.call("poseLastPlankton");
  await api.step(0.05);
  const s = await api.snapshot();
  const d = s.drifters[0];
  check.expectOk("the distant drifter exists", Boolean(d));
  const dist = Math.hypot(d.x - s.forager.x, d.y - s.forager.y);
  check.expectGt("the drifter is beyond the vision circle", dist, s.windowRadius);
  await api.wait(120);
  const col = await sampleColor(api, d.x, d.y);
  check.expectOk("the amber drifter is clipped to black beyond the circle", isDark(col));
  await api.screenshot("clipped");
  return check.verdict();
}
