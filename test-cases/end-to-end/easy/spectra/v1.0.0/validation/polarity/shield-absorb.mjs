// Automated validation for the Polarity sub-item `shield-absorb`.
//
// Your current band is your shield: a same-band enemy bullet is absorbed on
// contact, costing no life. The ship's band and lives are posed; a same-band enemy
// bullet is sent onto the ship, and the real shield resolves the contact.

import {
  startClean,
  spawnBystander,
  dropEnemyBullet,
  DROP_MAX_TICKS,
} from "../_helpers.mjs";

export default function item() {
  // The moment the absorb registered.
  let r;

  return {
    id: "polarity.shield-absorb",

    // The bullet is posed on the ship's OWN band, which is the case the shield is
    // supposed to swallow. The meter is zeroed so a rise in resonance is proof the
    // absorb happened, and lives are posed so a loss would be visible.
    async arrange(api) {
      await startClean(api);
      // A drone in formation keeps the wave alive while the bullet falls; nothing
      // is read from it (see `spawnBystander`).
      await spawnBystander(api);
      await api.call("setShipBand", "cyan");
      await api.call("setLives", 3);
      await api.call("setResonance", 0);
      // Dropped from the top of the field rather than posed on the hull: the fall
      // is what the clip shows. Posed on contact, the absorb resolved on the first
      // tick and the rest of the clip was aftermath (see `LEAD_IN_TICKS`).
      await dropEnemyBullet(api, "cyan"); // same band as the ship
    },

    async act(api) {
      // The bullet falls the length of the field and the absorb resolves when it
      // reaches the ship.
      r = await api.until((s) => s.resonance > 0, { max: DROP_MAX_TICKS });

      // Hold afterwards so the clip shows the ship still flying with its lives
      // intact — "no life was lost" needs a moment of aftermath to read.
      await api.advance(120); // 120 ticks = the old 1000 ms
    },

    async assert(api, check) {
      check.expectOk(
        "the same-band bullet is absorbed (resonance rises)",
        r.hit,
      );
      check.expectEq("no life is lost on a same-band bullet", r.snap.lives, 3);
    },
  };
}
