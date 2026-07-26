// Automated validation for the Polarity sub-item `drone-body-lethal`.
//
// A drone body on the ship always costs a life on contact, regardless of band —
// even a drone of the ship's OWN band, so a body is never mistaken for a shieldable
// same-band bullet. A same-band drone is posed onto the ship; the real body
// collision costs a life.

import { startClean, spawnDrone } from "../_helpers.mjs";

export default function item() {
  // The moment the life was lost.
  let r;

  return {
    id: "polarity.drone-body-lethal",

    // The drone is posed on the SHIP'S OWN band and in the ship's lane: same-band is
    // precisely the case a build might wrongly treat as shieldable, so that is the
    // one worth checking.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipBand", "cyan");
      await api.call("setLives", 3);
      await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 600,
        phase: "formation",
      });
    },

    async act(api) {
      r = await api.until((s) => s.lives < 3, { max: 36 }); // 36 ticks = the old 0.3 s

      // Hold past the hit so the clip shows the collision and the life dropping,
      // not just the frame the drone touches the ship.
      await api.advance(108); // 108 ticks = the old 900 ms
    },

    async assert(api, check) {
      check.expectOk("a same-band drone body still costs a life", r.hit);
      check.expectEq("a life is lost on body contact", r.snap.lives, 2);
    },
  };
}
