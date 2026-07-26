// Automated validation for the Stages sub-item `wave-persists`.
//
// Losing a life does not reset the wave: the drones persist, the resonance meter is
// kept, and the ship respawns at center after a brief hold. Resonance and drones
// are posed, a REAL lethal hit is taken, and the outcome — a lost life with the wave
// intact, then a respawn — is read back.

import { startClean, spawnDrone, shieldBullet } from "../_helpers.mjs";

export default function item() {
  // The moment of the hit, and the moment of the respawn.
  let hit;
  let resp;

  return {
    id: "stages.wave-persists",

    // Two drones and a part-filled meter, so "the wave persisted" is checkable as a
    // count that must not change and a meter that must not clear. The bullet is
    // posed opposite the ship's band, which is what makes it lethal.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipBand", "cyan");
      await api.call("setResonance", 40);
      await api.call("setLives", 3);
      await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 200,
        phase: "formation",
      });
      await spawnDrone(api, {
        kind: "shard",
        band: "magenta",
        x: 500,
        y: 200,
        phase: "formation",
      });
      await shieldBullet(api, "magenta"); // opposite the ship's band -> lethal
    },

    // The hit and the respawn that follows it — which is the whole behavior, and a
    // clip a reviewer can read directly: the ship dies, the swarm keeps flying, the
    // ship comes back at centre.
    async act(api) {
      hit = await api.until((s) => s.lives < 3, { max: 36 }); // 36 ticks = the old 0.3 s

      // After the READY hold the ship respawns at center.
      resp = await api.until((s) => s.ship.alive, { max: 240 }); // 240 ticks = the old 2 s

      // Hold on the respawned ship so the clip ends on the wave carrying on.
      await api.advance(180); // 180 ticks = the old 1500 ms
    },

    async assert(api, check) {
      check.expectEq("the hit costs exactly one life", hit.snap.lives, 2);
      check.expectEq(
        "the wave's drones persist through the hit",
        hit.snap.drones.length,
        2,
      );
      check.expectClose(
        "the resonance meter is kept",
        hit.snap.resonance,
        40,
        0.01,
      );
      check.expectOk("the ship respawns after the hold", resp.hit);
      check.expectClose("it respawns at center", resp.snap.ship.x, 640, 1);
    },
  };
}
