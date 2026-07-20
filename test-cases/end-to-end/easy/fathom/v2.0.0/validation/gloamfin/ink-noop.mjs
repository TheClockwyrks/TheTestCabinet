// gloamfin.ink-noop: ink has no effect on the sound-based Gloamfin; it keeps chasing.
import { startPlaying, findSightLine, denAllExcept, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gloamfin.ink-noop");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 3);
  await denAllExcept(api, ["gloamfin"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "gloamfin", { tx: line.pred.tx, ty: line.pred.ty, mode: "chase" });
  await api.call("poseLastPlankton");
  await api.step(0.05);
  check.expectEq("the Gloamfin is chasing", pred(await api.snapshot(), "gloamfin").state, "chase");
  await api.call("clearCooldowns");
  await api.call("press", "ShiftLeft"); // ink at the forager, over the line to the Gloamfin
  await api.step(0.3);
  check.expectEq("ink does not stop the Gloamfin (still chasing)", pred(await api.snapshot(), "gloamfin").state, "chase");
  await clip(api, 800);
  return check.verdict();
}
