// fog.light-line-of-sight: passive light does not bend around corners — a predator
// one step around a blind corner is not lit even though it is within light range.
import { startPlaying, findBlindPair, denAllExcept, pred } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fog.light-line-of-sight");
  const snap = await startPlaying(api);
  const bp = findBlindPair(snap, 4); // forager + pred around a blind corner
  await denAllExcept(api, ["gloamfin"]);
  await api.call("setForager", { tx: bp.forager.tx, ty: bp.forager.ty });
  await api.call("setPredator", "gloamfin", {
    tx: bp.pred.tx,
    ty: bp.pred.ty,
    mode: "wander",
  });
  await api.call("setBrightness", 1); // V = 160 px, well past the blind-corner gap
  await api.step(0.05);
  const g = pred(await api.snapshot(), "gloamfin");
  check.expectOk(
    "a predator around a blind corner is not lit by the light",
    g.lit === false,
  );
  await api.wait(100);
  await api.screenshot("los");
  return check.verdict();
}
