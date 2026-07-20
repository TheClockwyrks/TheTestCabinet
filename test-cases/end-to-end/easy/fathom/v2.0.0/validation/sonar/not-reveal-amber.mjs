// sonar.not-reveal-amber: a pulse marks the Gloamfin but never the Lanternjaw (an
// amber-light entity) — after the same pulse the Gloamfin is lit and the Lanternjaw
// is not.
import {
  startPlaying,
  denAllExcept,
  findSonarSenseTiles,
  pred,
  stepUntil,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sonar.not-reveal-amber");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["gloamfin", "lanternjaw"]);
  const [g, l] = findSonarSenseTiles(snap, snap.forager, 2);
  await api.call("setPredator", "gloamfin", { tx: g.tx, ty: g.ty, mode: "wander" });
  await api.call("setPredator", "lanternjaw", { tx: l.tx, ty: l.ty, mode: "wander" });
  await api.call("poseLastPlankton"); // keep the forager dark (g stays 0)
  await api.call("clearCooldowns");
  await api.call("press", "Space");
  const r = await stepUntil(api, (s) => pred(s, "gloamfin").lit === true, 1.5);
  const s = r.snap;
  check.expectOk("the sonar marks the Gloamfin visible", pred(s, "gloamfin").lit === true);
  check.expectOk(
    "the sonar never reveals the amber Lanternjaw",
    pred(s, "lanternjaw").lit === false,
  );
  await api.wait(100);
  await api.screenshot("amber");
  return check.verdict();
}
