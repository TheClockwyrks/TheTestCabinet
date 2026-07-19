// flarefish.no-tell: no amber bulb and no ping — between flares its body is unrevealed
// unless your light or sonar reaches it (the sampled pixel is not amber).
import {
  startPlaying,
  findBlindPair,
  denAllExcept,
  pred,
  sampleColor,
  isAmber,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flarefish.no-tell");
  const snap = await startPlaying(api);
  const bp = findBlindPair(snap, 4); // near enough for the Kindle circle, LOS blocked
  await denAllExcept(api, ["flarefish"]);
  await api.call("setForager", { tx: bp.forager.tx, ty: bp.forager.ty });
  await api.call("setPredator", "flarefish", { tx: bp.pred.tx, ty: bp.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.step(0.05);
  const p = pred(await api.snapshot(), "flarefish");
  check.expectOk("the Flarefish body is not lit between flares", p.lit === false);
  check.expectOk("it is not flaring", p.flaring === false);
  await api.wait(120);
  const col = await sampleColor(api, p.x, p.y);
  check.expectOk("it gives off no amber bulb (its spot is not amber)", isAmber(col) === false);
  await api.screenshot("notell");
  return check.verdict();
}
