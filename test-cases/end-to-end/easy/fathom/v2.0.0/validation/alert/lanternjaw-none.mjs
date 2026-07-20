// alert.lanternjaw-none: the Lanternjaw fires no detection alert — its bulb is the tell.
import { startPlaying, findSightLine, denAllExcept, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("alert.lanternjaw-none");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 3);
  await denAllExcept(api, ["lanternjaw"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "lanternjaw", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.call("setBrightness", 1);
  let sawChase = false;
  let anyAlert = false;
  for (let i = 0; i < 30; i++) {
    await api.step(0.02);
    const p = pred(await api.snapshot(), "lanternjaw");
    if (p.state === "chase") sawChase = true;
    if (p.alert === true) anyAlert = true;
  }
  check.expectOk("the Lanternjaw does acquire the forager (so the check is meaningful)", sawChase);
  check.expectOk("the Lanternjaw never fires a detection alert", anyAlert === false);
  await clip(api, 700);
  return check.verdict();
}
