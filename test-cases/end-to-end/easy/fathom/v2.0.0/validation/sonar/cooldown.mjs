// sonar.cooldown: emitting a pulse starts a ~1.5 s cooldown before it is ready again.
import { startPlaying, SONAR_COOLDOWN, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sonar.cooldown");
  await startPlaying(api);
  await api.call("clearCooldowns");
  check.expectOk("sonar is ready before firing", (await api.snapshot()).sonar.ready);
  await api.call("press", "Space");
  await api.step(0.02);
  const s1 = await api.snapshot();
  check.expectOk("sonar is on cooldown right after firing", s1.sonar.ready === false);
  check.expectClose("the cooldown is ~1.5 s", s1.sonar.cooldown, SONAR_COOLDOWN, 0.2);
  await api.step(SONAR_COOLDOWN);
  check.expectOk("sonar is ready again after the cooldown", (await api.snapshot()).sonar.ready);
  await clip(api, 700);
  return check.verdict();
}
