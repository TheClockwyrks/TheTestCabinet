// ink.cloud: an ink cloud is ~80 px in radius, lingers ~3 s, and stays fixed in place.
import { startPlaying, INK_RADIUS, INK_LIFE, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ink.cloud");
  await startPlaying(api);
  await api.call("clearCooldowns");
  await api.call("press", "ShiftLeft");
  await api.step(0.02);
  const c0 = (await api.snapshot()).inkClouds[0];
  check.expectOk("an ink cloud exists", Boolean(c0));
  check.expectClose("its radius is ~80 px", c0.radius, INK_RADIUS, 20);
  check.expectClose("it lingers ~3 s", c0.remaining, INK_LIFE, 0.3);
  await api.step(1.0);
  const c1 = (await api.snapshot()).inkClouds[0];
  check.expectOk("the cloud stays fixed where it was released", Math.abs(c1.x - c0.x) < 1 && Math.abs(c1.y - c0.y) < 1);
  check.expectLt("its remaining lifetime decreases as it lingers", c1.remaining, c0.remaining);
  await clip(api, 800);
  return check.verdict();
}
