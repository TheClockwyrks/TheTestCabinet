// lanternjaw.los-break: a wall breaks its sense — it does not fix on a forager around
// a blind corner even within range.
import { startPlaying, findBlindPair, denAllExcept, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lanternjaw.los-break");
  const snap = await startPlaying(api);
  const bp = findBlindPair(snap, 4); // within range, LOS blocked
  await denAllExcept(api, ["lanternjaw"]);
  await api.call("setForager", { tx: bp.forager.tx, ty: bp.forager.ty });
  await api.call("setPredator", "lanternjaw", { tx: bp.pred.tx, ty: bp.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.call("setBrightness", 1); // R = 320 px, so only the wall can block the sense
  await api.step(0.05);
  const p = pred(await api.snapshot(), "lanternjaw");
  check.expectEq("a wall breaks the Lanternjaw's sense (still wandering)", p.state, "wander");
  check.expectOk("it stays disguised behind the wall", p.disguised === true);
  await clip(api, 800);
  return check.verdict();
}
