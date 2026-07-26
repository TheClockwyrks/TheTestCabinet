// Automated validation for the Polarity sub-item `resonance-absorb-fills`.
//
// Absorbing a same-band enemy bullet feeds the resonance meter (about 6 of 100 per
// bullet). The meter is zeroed as a precondition; one same-band bullet is absorbed
// by the real shield, and the resonance gain is read back.

import { startClean, shieldBullet, RES_ABSORB } from "../_helpers.mjs";

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
      await api.call("setShipBand", "cyan");
      await api.call("setResonance", 0);
      await shieldBullet(api, "cyan");
    },

    async act(api) {
      r = await api.until((s) => s.resonance > 0, { max: 36 }); // 36 ticks = the old 0.3 s

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
