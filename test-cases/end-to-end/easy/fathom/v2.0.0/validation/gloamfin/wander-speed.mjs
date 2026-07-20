// gloamfin.wander-speed: it wanders at ~116 px/s with no wind-up over time.
import { startPlaying, denAllExcept, findFarTile, pred, PREDATOR_SPEED, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gloamfin.wander-speed");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["gloamfin"]);
  const far = findFarTile(snap, snap.forager, 8); // far, so it just wanders
  await api.call("setPredator", "gloamfin", { tx: far.tx, ty: far.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.step(0.2);
  const a = pred(await api.snapshot(), "gloamfin").speed;
  await api.step(1.0);
  const b = pred(await api.snapshot(), "gloamfin").speed;
  check.expectClose("wanders at ~116 px/s", a, PREDATOR_SPEED, 8);
  check.expectClose("no speed wind-up over time (still ~116 px/s)", b, PREDATOR_SPEED, 8);
  await clip(api, 900);
  return check.verdict();
}
