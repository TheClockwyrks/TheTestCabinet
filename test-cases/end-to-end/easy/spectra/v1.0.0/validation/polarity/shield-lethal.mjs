// Automated validation for the Polarity sub-item `shield-lethal`.
//
// An enemy bullet of the band OPPOSITE the ship's is not shielded: it costs a
// life. The ship's band and lives are posed; an opposite-band bullet is sent onto
// the ship, and the real shield resolves it into a lost life.

import {
  startClean,
  spawnBystander,
  dropEnemyBullet,
  DROP_MAX_TICKS,
} from "../_helpers.mjs";

export default function item() {
  // The moment the life was lost.
  let r;

  return {
    id: "polarity.shield-lethal",

    // The bullet is posed on the band OPPOSITE the ship's — the case the shield must
    // NOT swallow — with lives posed high enough that the loss is a decrement rather
    // than a game over.
    async arrange(api) {
      await startClean(api);
      // A drone in formation keeps the wave alive while the bullet falls; nothing
      // is read from it (see `spawnBystander`).
      await spawnBystander(api);
      await api.call("setShipBand", "cyan");
      await api.call("setLives", 3);
      // Dropped from the top of the field rather than posed on the hull: the fall
      // is what the clip shows. Posed on contact, the hit resolved on the first tick
      // and the clip was nothing but the READY hold that follows (see
      // `LEAD_IN_TICKS`).
      await dropEnemyBullet(api, "magenta"); // opposite the ship's band
    },

    async act(api) {
      r = await api.until((s) => s.lives < 3, { max: DROP_MAX_TICKS });

      // Hold past the hit so the clip shows the strike and its consequence.
      await api.advance(120); // 120 ticks = the old 1000 ms
    },

    async assert(api, check) {
      check.expectOk("an opposite-band bullet costs a life", r.hit);
      check.expectEq(
        "a life is lost on the opposite-band bullet",
        r.snap.lives,
        2,
      );
    },
  };
}
