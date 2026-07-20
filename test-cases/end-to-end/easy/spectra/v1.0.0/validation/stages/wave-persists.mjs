// Automated validation for the Stages sub-item `wave-persists`.
//
// Losing a life does not reset the wave: the drones persist, the resonance meter is
// kept, and the ship respawns at center after a brief hold. Resonance and drones
// are posed, a REAL lethal hit is taken, and the outcome — a lost life with the wave
// intact, then a respawn — is read back.

import {
  startClean,
  spawnDrone,
  shieldBullet,
  stepUntil,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stages.wave-persists");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("setResonance", 40);
  await api.call("setLives", 3);
  await spawnDrone(api, { kind: "shard", band: "cyan", x: 640, y: 200, phase: "formation" });
  await spawnDrone(api, { kind: "shard", band: "magenta", x: 500, y: 200, phase: "formation" });

  await shieldBullet(api, "magenta"); // opposite the ship's band -> lethal
  const hit = await stepUntil(api, (s) => s.lives < 3, 0.3);
  check.expectEq("the hit costs exactly one life", hit.snap.lives, 2);
  check.expectEq("the wave's drones persist through the hit", hit.snap.drones.length, 2);
  check.expectClose("the resonance meter is kept", hit.snap.resonance, 40, 0.01);

  // After the READY hold the ship respawns at center.
  const resp = await stepUntil(api, (s) => s.ship.alive, 2);
  check.expectOk("the ship respawns after the hold", resp.hit);
  check.expectClose("it respawns at center", resp.snap.ship.x, 640, 1);

  await clip(api, 1500);
  return check.verdict();
}
