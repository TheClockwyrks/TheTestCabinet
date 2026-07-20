// trench.amber-any-distance: the amber lights show at any distance in the Trench dive,
// even far out in the dark (not clipped to a window).
import {
  startPlaying,
  denAllExcept,
  findFarTile,
  sampleAmberOrb,
  isAmber,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trench.amber-any-distance");
  const snap = await startPlaying(api);
  await denAllExcept(api, []);
  const far = findFarTile(snap, snap.forager, 9); // far out in the dark
  await api.call("spawnDrifter", { tx: far.tx, ty: far.ty });
  await api.call("poseLastPlankton");
  await api.step(0.05);
  const d = (await api.snapshot()).drifters[0];
  check.expectOk("the distant drifter exists", Boolean(d));
  await api.wait(120);
  const col = await sampleAmberOrb(api, d.x, d.y);
  check.expectOk("the distant amber drifter is still drawn amber", isAmber(col));
  await api.screenshot("amber");
  return check.verdict();
}
