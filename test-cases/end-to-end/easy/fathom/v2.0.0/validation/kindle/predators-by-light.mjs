// kindle.predators-by-light: predators are revealed by the line-of-sight light circle,
// not the vision circle — a predator inside the vision circle but beyond the light is
// not shown.
import { startPlaying, findSightLine, denAllExcept, pred } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("kindle.predators-by-light");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["gloamfin"]);
  const line = findSightLine(snap, 4); // 128 px: beyond the light (96), inside the circle (192)
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "gloamfin", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.step(0.05);
  const s = await api.snapshot();
  const g = pred(s, "gloamfin");
  const dist = Math.hypot(g.x - s.forager.x, g.y - s.forager.y);
  check.expectLt("the Gloamfin is inside the vision circle", dist, s.windowRadius);
  check.expectGt("but beyond the light circle", dist, s.visionRadius);
  check.expectOk("it is not shown (predators follow the light, not the vision circle)", g.lit === false);
  await api.wait(120);
  await api.screenshot("bylight");
  return check.verdict();
}
