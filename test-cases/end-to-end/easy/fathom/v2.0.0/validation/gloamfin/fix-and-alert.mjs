// gloamfin.fix-and-alert: hearing the forager at close range hands it a fix — it fires
// the alert and chases.
import { startPlaying, findSightLine, denAllExcept, pred, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gloamfin.fix-and-alert");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 2); // 64 px — inside close hearing
  await denAllExcept(api, ["gloamfin"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "gloamfin", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  check.expectEq("the Gloamfin starts wandering", pred(await api.snapshot(), "gloamfin").state, "wander");
  const r = await stepUntil(api, (s) => pred(s, "gloamfin").state === "chase", 0.5);
  check.expectOk("close hearing hands it a fix (it chases)", r.hit);
  check.expectOk("the detection alert fires on the fix", pred(r.snap, "gloamfin").alert === true);
  await clip(api, 800);
  return check.verdict();
}
