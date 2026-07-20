// lanternjaw.wander-disguise: undetected it drifts at the drifter's ~64 px/s (reading
// disguised); on a fix it drops the disguise and hunts at ~116 px/s.
import {
  startPlaying,
  findSonarTarget,
  denAllExcept,
  pred,
  DRIFTER_SPEED,
  PREDATOR_SPEED,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lanternjaw.wander-disguise");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["lanternjaw"]);
  const target = findSonarTarget(snap, snap.forager); // beyond the light, so it stays undetected
  await api.call("setPredator", "lanternjaw", { tx: target.tx, ty: target.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.step(0.2);
  const w = pred(await api.snapshot(), "lanternjaw");
  check.expectOk("undetected it reads as disguised", w.disguised === true);
  check.expectClose("it drifts at the drifter's ~64 px/s", w.speed, DRIFTER_SPEED, 6);

  await api.call("setPredator", "lanternjaw", { tx: target.tx, ty: target.ty, mode: "chase" });
  await api.step(0.05);
  const h = pred(await api.snapshot(), "lanternjaw");
  check.expectOk("on a fix it drops the disguise", h.disguised === false);
  check.expectClose("and hunts at ~116 px/s", h.speed, PREDATOR_SPEED, 10);
  await clip(api, 900);
  return check.verdict();
}
