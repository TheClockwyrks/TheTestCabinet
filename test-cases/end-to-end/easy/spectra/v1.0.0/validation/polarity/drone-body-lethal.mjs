// Automated validation for the Polarity sub-item `drone-body-lethal`.
//
// A drone body on the ship always costs a life on contact, regardless of band —
// even a drone of the ship's OWN band, so a body is never mistaken for a shieldable
// same-band bullet. A same-band drone is posed onto the ship; the real body
// collision costs a life.

import { startClean, spawnDrone, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.drone-body-lethal");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("setLives", 3);
  // A drone of the SHIP'S OWN band, placed on the ship's lane.
  await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 600,
    phase: "formation",
  });
  const r = await stepUntil(api, (s) => s.lives < 3, 0.3);
  check.expectOk("a same-band drone body still costs a life", r.hit);
  check.expectEq("a life is lost on body contact", r.snap.lives, 2);

  await clip(api, 900);
  return check.verdict();
}
