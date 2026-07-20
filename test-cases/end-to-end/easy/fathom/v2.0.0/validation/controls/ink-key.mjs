// controls.ink-key: Shift releases an ink cloud when ready.
import { startPlaying, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.ink-key");
  await startPlaying(api);
  await api.call("clearCooldowns");
  const before = (await api.snapshot()).inkClouds.length;
  await api.call("press", "ShiftLeft");
  await api.step(0.02);
  const s = await api.snapshot();
  check.expectGt("Shift releases an ink cloud", s.inkClouds.length, before);
  await clip(api, 700);
  return check.verdict();
}
