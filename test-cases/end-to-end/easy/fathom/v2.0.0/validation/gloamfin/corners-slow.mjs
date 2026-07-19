// gloamfin.corners-slow: a corner the chasing Gloamfin turns drops it below the
// forager's speed before it ramps back up.
import { startPlaying, findCorner, denAllExcept, pred, FORAGER_SPEED, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gloamfin.corners-slow");
  const snap = await startPlaying(api);
  const c = findCorner(snap);
  // Forager on the perpendicular arm; Gloamfin on the approach arm, chasing — its path
  // to the forager turns a perpendicular corner at the junction.
  await api.call("setForager", { tx: c.perpTile.tx, ty: c.perpTile.ty });
  await api.call("setPredator", "gloamfin", { tx: c.back.tx, ty: c.back.ty, mode: "chase" });
  await api.call("poseLastPlankton");
  let sawBelow = false;
  let minSpeed = Infinity;
  for (let i = 0; i < 40; i++) {
    await api.step(0.03);
    const s = await api.snapshot();
    if (s.screen !== "playing") break;
    const g = pred(s, "gloamfin");
    minSpeed = Math.min(minSpeed, g.speed);
    if (g.speed < FORAGER_SPEED) sawBelow = true;
  }
  check.expectOk("cornering drops the Gloamfin below the forager's 128 px/s", sawBelow);
  check.expectLt("the corner floor is below the forager's speed", minSpeed, FORAGER_SPEED);
  await clip(api, 800);
  return check.verdict();
}
