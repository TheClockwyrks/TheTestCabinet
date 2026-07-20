// kindle.grows-with-eating: the vision-circle radius grows with brightness (R = 192 + 128 G).
import { startPlaying, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("kindle.grows-with-eating");
  await startPlaying(api);
  await api.call("poseLastPlankton"); // keep the forager from eating and skewing G
  await api.call("setBrightness", 0);
  await api.step(0.02);
  const r0 = (await api.snapshot()).windowRadius;
  await api.call("setBrightness", 1);
  await api.step(0.02);
  const r1 = (await api.snapshot()).windowRadius;
  check.expectGt("the vision circle grows with brightness", r1, r0);
  check.expectClose("radius at G=0 is ~192 px", r0, 192, 20);
  check.expectClose("radius at G=1 is ~320 px", r1, 320, 24);
  await clip(api, 800);
  return check.verdict();
}
