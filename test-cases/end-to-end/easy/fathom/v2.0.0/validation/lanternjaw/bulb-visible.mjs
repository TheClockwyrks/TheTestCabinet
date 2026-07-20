// lanternjaw.bulb-visible: the Lanternjaw's amber bulb is drawn even when its tile is
// unrevealed fog (its body unlit) — sampled from the rendered canvas.
import {
  startPlaying,
  findBlindPair,
  denAllExcept,
  pred,
  sampleAmberOrb,
  isAmber,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lanternjaw.bulb-visible");
  const snap = await startPlaying(api);
  const bp = findBlindPair(snap, 4); // close enough for the Kindle circle, LOS blocked so unlit
  await denAllExcept(api, ["lanternjaw"]);
  await api.call("setForager", { tx: bp.forager.tx, ty: bp.forager.ty });
  await api.call("setPredator", "lanternjaw", { tx: bp.pred.tx, ty: bp.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.step(0.05);
  const p = pred(await api.snapshot(), "lanternjaw");
  check.expectOk("the Lanternjaw's tile is unlit fog", p.lit === false);
  await api.wait(120);
  const col = await sampleAmberOrb(api, p.x, p.y);
  check.expectOk("its amber bulb is still drawn in the dark", isAmber(col));
  await api.screenshot("bulb");
  return check.verdict();
}
