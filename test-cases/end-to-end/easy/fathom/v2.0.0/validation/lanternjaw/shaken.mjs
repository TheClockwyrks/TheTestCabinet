// lanternjaw.shaken: ink between the Lanternjaw and the forager breaks its fix.
import { startPlaying, findSightLine, denAllExcept, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lanternjaw.shaken");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 2); // close, so ink at the forager covers the line
  await denAllExcept(api, ["lanternjaw"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "lanternjaw", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.call("setBrightness", 1);
  await api.step(0.05);
  check.expectEq(
    "the Lanternjaw is fixed on the forager first",
    pred(await api.snapshot(), "lanternjaw").state,
    "chase",
  );
  await api.call("clearCooldowns");
  await api.call("press", "ShiftLeft"); // drop ink at the forager
  await api.step(0.2);
  check.expectEq(
    "ink between them breaks the Lanternjaw's fix",
    pred(await api.snapshot(), "lanternjaw").state,
    "wander",
  );
  await clip(api, 800);
  return check.verdict();
}
