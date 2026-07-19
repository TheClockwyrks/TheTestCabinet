// flarefish.ink-breaks: ink breaks the Flarefish's fix, exactly as it breaks the
// Lanternjaw's.
import { startPlaying, findSightLine, denAllExcept, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flarefish.ink-breaks");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 2); // close, so the ink at the forager covers the line
  await denAllExcept(api, ["flarefish"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "flarefish", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.call("setBrightness", 1);
  await api.step(0.05);
  check.expectEq("the Flarefish is fixed on the forager first", pred(await api.snapshot(), "flarefish").state, "chase");
  await api.call("clearCooldowns");
  await api.call("press", "ShiftLeft");
  await api.step(0.2);
  check.expectEq("ink breaks the Flarefish's fix", pred(await api.snapshot(), "flarefish").state, "wander");
  await clip(api, 800);
  return check.verdict();
}
