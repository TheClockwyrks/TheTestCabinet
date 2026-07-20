// alert.gloamfin: a Gloamfin acquisition fires the detection alert.
import { startPlaying, findSightLine, denAllExcept, pred, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("alert.gloamfin");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 2); // inside close hearing
  await denAllExcept(api, ["gloamfin"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "gloamfin", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  const r = await stepUntil(api, (s) => pred(s, "gloamfin").alert === true, 0.6);
  check.expectOk("the Gloamfin fires the detection alert on a fix", r.hit);
  await clip(api, 700);
  return check.verdict();
}
