// sonar.heard-by-gloamfin: a pulse reaching a wandering Gloamfin hands it a fix — it
// fires the alert and turns to chase.
import {
  startPlaying,
  denAllExcept,
  findSonarSenseTiles,
  pred,
  stepUntil,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sonar.heard-by-gloamfin");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["gloamfin"]);
  const [target] = findSonarSenseTiles(snap, snap.forager, 1); // beyond hearing, inside the flood
  await api.call("setPredator", "gloamfin", { tx: target.tx, ty: target.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.step(0.02);
  check.expectEq(
    "the Gloamfin is wandering before the pulse",
    pred(await api.snapshot(), "gloamfin").state,
    "wander",
  );
  await api.call("clearCooldowns");
  await api.call("press", "Space");
  const r = await stepUntil(api, (s) => pred(s, "gloamfin").state === "chase", 1.5);
  check.expectOk("the pulse hands the wandering Gloamfin a fix (it chases)", r.hit);
  check.expectOk(
    "the detection alert fires on the heard pulse",
    pred(r.snap, "gloamfin").alert === true,
  );
  await clip(api, 900);
  return check.verdict();
}
