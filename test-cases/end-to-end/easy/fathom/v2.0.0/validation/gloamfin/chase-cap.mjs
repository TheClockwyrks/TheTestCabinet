// gloamfin.chase-cap: on a straight run it chases at its ~134 px/s cap.
import { startPlaying, findSightLine, denAllExcept, pred, GLOAMFIN_CHASE, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gloamfin.chase-cap");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 4); // straight corridor, 4 tiles apart
  await denAllExcept(api, ["gloamfin"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "gloamfin", { tx: line.pred.tx, ty: line.pred.ty, mode: "chase" });
  await api.call("poseLastPlankton");
  await api.step(0.3); // chasing straight, no corner — speed at the cap
  const p = pred(await api.snapshot(), "gloamfin");
  check.expectEq("the Gloamfin is chasing", p.state, "chase");
  check.expectClose("it chases at its ~134 px/s cap on a straight run", p.speed, GLOAMFIN_CHASE, 6);
  await clip(api, 800);
  return check.verdict();
}
