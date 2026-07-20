// scoring.depth-scaling: a deeper trench speeds the predators up and shortens the sonar
// range.
import { startPlaying, denAllExcept, findFarTile, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.depth-scaling");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["gloamfin"]);
  const far = findFarTile(snap, snap.forager, 8);
  await api.call("setPredator", "gloamfin", { tx: far.tx, ty: far.ty, mode: "wander" });
  await api.call("poseLastPlankton");

  await api.call("setDepth", 1);
  await api.step(0.2);
  const s1 = await api.snapshot();
  const speed1 = pred(s1, "gloamfin").speed;

  await api.call("setDepth", 5);
  await api.step(0.2);
  const s5 = await api.snapshot();
  const speed5 = pred(s5, "gloamfin").speed;

  check.expectGt("predators are faster at greater depth", speed5, speed1);
  check.expectClose("sonar range is 9 tiles at depth 1", s1.sonar.range, 9, 1);
  check.expectLt("sonar range shrinks at greater depth", s5.sonar.range, s1.sonar.range);
  check.expectGe("sonar range never drops below 5", s5.sonar.range, 5);
  await clip(api, 800);
  return check.verdict();
}
