// sonar.wavefront: a pulse is a wavefront that advances outward, not an instant circle.
import { startPlaying, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sonar.wavefront");
  await startPlaying(api);
  await api.call("clearCooldowns");
  await api.call("press", "Space");
  const fronts = [];
  for (let i = 0; i < 4; i++) {
    await api.step(0.1);
    const p = (await api.snapshot()).pulses.find((q) => q.source === "forager");
    fronts.push(p ? p.front : -1);
  }
  check.expectOk("a forager pulse is in flight", fronts[0] >= 0);
  check.expectGt("the wavefront advances outward over time (near-to-far)", fronts[3], fronts[0]);
  check.expectGt("the front travels several tiles, not an instant circle", fronts[3], 2);
  await clip(api, 900);
  return check.verdict();
}
