// lanternjaw.light-range: the Lanternjaw fixes on the forager within its light range
// and line of sight; the reported range follows R = 128 + 192 G.
import { startPlaying, findSightLine, denAllExcept, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lanternjaw.light-range");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 3); // 96 px apart, clear line of sight
  await denAllExcept(api, ["lanternjaw"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "lanternjaw", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.call("setBrightness", 1); // R = 320 px, well past the 96 px gap
  await api.step(0.05);
  const p = pred(await api.snapshot(), "lanternjaw");
  check.expectEq("the Lanternjaw fixes on the forager within range and LOS", p.state, "chase");
  check.expectOk("it drops its disguise on the fix", p.disguised === false);
  check.expectClose("the detection range follows 128 + 192 G", p.detectRange, 320, 24);
  await clip(api, 900);
  return check.verdict();
}
