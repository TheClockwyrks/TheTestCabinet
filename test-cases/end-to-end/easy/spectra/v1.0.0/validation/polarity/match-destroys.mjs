// Automated validation for the Polarity sub-item `match-destroys`.
//
// A player shot whose band matches the drone's current band destroys it. The
// drone is posed (a precondition); the real collision, run forward by stepping the
// real simulation, is what destroys it — the outcome is read back from snapshot().

import {
  startClean,
  spawnDrone,
  shootDrone,
  findDrone,
  stepUntil,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.match-destroys");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
  });
  await shootDrone(api, id, "cyan"); // matching band
  const r = await stepUntil(api, (s) => findDrone(s, id) === null, 0.5);
  check.expectOk("a matching-band shot destroys the drone", r.hit);

  // A live clip: a shot rising into a drone and popping it.
  await startClean(api);
  const id2 = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
  });
  await api.call("spawnPlayerBullet", { x: 640, y: 540, band: "cyan" });
  await clip(api, 1200);

  return check.verdict();
}
