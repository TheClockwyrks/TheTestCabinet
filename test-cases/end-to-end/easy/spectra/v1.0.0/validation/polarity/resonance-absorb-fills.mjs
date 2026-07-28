// Automated validation for the Polarity sub-item `resonance-absorb-fills`.
//
// Absorbing a same-band enemy bullet feeds the resonance meter (about 6 of 100 per
// bullet). The meter is zeroed as a precondition; one same-band bullet is absorbed
// by the real shield, and the resonance gain is read back.

import {
  startClean,
  spawnBystander,
  dropEnemyBullet,
  DROP_MAX_TICKS,
  RES_ABSORB,
} from "../_helpers.mjs";

export default function item() {
  // The moment the meter first moved.
  let r;

  return {
    id: "polarity.resonance-absorb-fills",

    // The meter is zeroed so the gain read below is attributable to exactly one
    // absorbed bullet, and the bullet is posed on the ship's own band so the shield
    // absorbs rather than takes a life.
    async arrange(api) {
      await startClean(api);
      // A drone in formation keeps the wave alive while the bullet falls; nothing
      // is read from it (see `spawnBystander`).
      await spawnBystander(api);
      await api.call("setShipBand", "cyan");
      await api.call("setResonance", 0);
      // Dropped from the top of the field rather than posed on the hull, so the
      // clip shows the bullet reaching the ship and the meter stepping up. Posed on
      // contact, the whole event was over on the first tick (see
      // `LEAD_IN_TICKS`).
      await dropEnemyBullet(api, "cyan");
    },

    async act(api) {
      r = await api.until((s) => s.resonance > 0, { max: DROP_MAX_TICKS });

      // Hold on the filled meter so the clip shows the absorb and the meter's step
      // up, rather than cutting the frame it happens.
      await api.advance(156); // 156 ticks = the old liveWaveClip's 1300 ms
    },

    async assert(api, check) {
      check.expectOk("absorbing a bullet raises resonance", r.hit);
      check.expectClose(
        "one absorbed bullet adds about 6 resonance",
        r.snap.resonance,
        RES_ABSORB,
        0.01,
      );
    },
  };
}
