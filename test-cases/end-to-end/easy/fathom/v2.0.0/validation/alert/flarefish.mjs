// alert.flarefish: a Flarefish acquisition (here via light-sense) fires the alert.
import { startPlaying, findSightLine, denAllExcept, pred, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("alert.flarefish");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 3);
  await denAllExcept(api, ["flarefish"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "flarefish", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.call("setBrightness", 1);
  const r = await stepUntil(api, (s) => pred(s, "flarefish").alert === true, 0.6);
  check.expectOk("the Flarefish fires the detection alert on a fix", r.hit);
  await clip(api, 700);
  return check.verdict();
}
