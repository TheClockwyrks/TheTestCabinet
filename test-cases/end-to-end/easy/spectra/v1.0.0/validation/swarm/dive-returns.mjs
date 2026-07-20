// Automated validation for the Swarm sub-item `dive-returns`.
//
// A drone that survives its dive returns to its formation slot (phase returning,
// then formation back at its slot) rather than vanishing. A formation drone is
// posed, a REAL dive launched, and the real motion systems stepped forward until
// the drone loops back and re-settles.

import { startClean, spawnDrone, findDrone, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("swarm.dive-returns");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 200,
    phase: "formation",
  });
  await api.step(0.05);
  await api.call("forceDive", id);

  // The drone loops back: it enters the returning phase, then re-settles.
  const ret = await stepUntil(api, (s) => {
    const d = findDrone(s, id);
    return d !== null && d.phase === "returning";
  }, 6);
  check.expectOk("the diver enters the returning phase", ret.hit);

  const home = await stepUntil(api, (s) => {
    const d = findDrone(s, id);
    return d !== null && d.phase === "formation";
  }, 6);
  check.expectOk("the diver re-settles into formation", home.hit);
  const d = findDrone(home.snap, id);
  if (d) check.expectClose("it returns to its slot y", d.y, d.slotY, 1);

  await clip(api, 1400);
  return check.verdict();
}
