// sonar.marks-predators: as the front sweeps over a Flarefish it marks it briefly
// visible (the Flarefish neither hears the ping nor lights up on its own, so a
// visible Flarefish after the pulse is the sonar mark).
import {
  startPlaying,
  denAllExcept,
  findSonarSenseTiles,
  pred,
  stepUntil,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sonar.marks-predators");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["flarefish"]);
  const [target] = findSonarSenseTiles(snap, snap.forager, 1);
  await api.call("setPredator", "flarefish", { tx: target.tx, ty: target.ty, mode: "wander" });
  await api.call("poseLastPlankton"); // keep the stationary forager dark (g stays 0)
  await api.step(0.05);
  check.expectOk(
    "the Flarefish is unseen before the pulse (beyond the light)",
    pred(await api.snapshot(), "flarefish").lit === false,
  );
  await api.call("clearCooldowns");
  await api.call("press", "Space");
  const r = await stepUntil(api, (s) => pred(s, "flarefish").lit === true, 1.5);
  check.expectOk("the sonar front marks the Flarefish visible", r.hit);
  await clip(api, 900);
  return check.verdict();
}
