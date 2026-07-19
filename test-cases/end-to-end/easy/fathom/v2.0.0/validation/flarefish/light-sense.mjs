// flarefish.light-sense: drifting into your glow (within R, line of sight) fixes it on
// you, exactly like the Lanternjaw — no flare needed.
import { startPlaying, findSightLine, denAllExcept, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flarefish.light-sense");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 3);
  await denAllExcept(api, ["flarefish"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "flarefish", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.call("setBrightness", 1); // R = 320 px, well within the 96 px gap
  await api.step(0.05);
  const p = pred(await api.snapshot(), "flarefish");
  check.expectEq("the Flarefish fixes on your light without flaring", p.state, "chase");
  check.expectOk("its detection alert fires on the light-sense fix", p.alert === true);
  await clip(api, 800);
  return check.verdict();
}
