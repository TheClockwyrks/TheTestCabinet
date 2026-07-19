// amber.drifter-permanent: a drifter persists (does not fade) until eaten.
import { startPlaying, findFarTile, denAllExcept, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("amber.drifter-permanent");
  const snap = await startPlaying(api);
  await denAllExcept(api, []); // den all predators so none disturbs the scene
  const far = findFarTile(snap, snap.forager, 10); // far from the stationary forager, so it is not eaten
  await api.call("spawnDrifter", { tx: far.tx, ty: far.ty });
  await api.call("poseLastPlankton");
  const n0 = (await api.snapshot()).drifters.length;
  check.expectGt("the drifter spawned", n0, 0);
  await api.step(8); // let a long stretch of time pass
  const n1 = (await api.snapshot()).drifters.length;
  check.expectGe("the drifter still exists after time passes (it does not fade)", n1, n0);
  await clip(api, 900);
  return check.verdict();
}
