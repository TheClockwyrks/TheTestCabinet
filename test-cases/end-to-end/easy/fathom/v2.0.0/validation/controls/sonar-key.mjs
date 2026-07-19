// controls.sonar-key: Space emits a sonar pulse when ready.
import { startPlaying, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.sonar-key");
  await startPlaying(api);
  await api.call("clearCooldowns");
  const before = (await api.snapshot()).pulses.filter((p) => p.source === "forager").length;
  await api.call("press", "Space");
  await api.step(0.05);
  const s = await api.snapshot();
  const forager = s.pulses.filter((p) => p.source === "forager");
  check.expectGt("Space emits a forager sonar pulse", forager.length, before);
  check.expectEq(
    "the pulse is the forager's cyan ping",
    (forager[0] || {}).tint,
    "cyan",
  );
  await clip(api, 900);
  return check.verdict();
}
