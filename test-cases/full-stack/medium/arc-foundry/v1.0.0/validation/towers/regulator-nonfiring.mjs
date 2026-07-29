// Automated validation for towers.regulator-nonfiring: the Regulator is a non-firing support
// node — it never fires, launches no projectile, does not rotate a head or damage a unit in
// range, and only projects an aura.
//
// Arming the Regulator and releasing the Mote are control ops (the arrange). The claim is a
// NEGATIVE — that nothing happens — so the act is the half second of nothing happening, which
// is also the only honest clip: a unit walks straight through the Regulator's range untouched.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  towerById,
  unitById,
  snap,
  SECOND,
} from "../_helpers.mjs";

// Three seconds — several cadences of every firing type, so a tower that was going to shoot
// would have, several times over. It is also long enough to WATCH the Mote cross the aura and
// walk out the far side untouched, which is the whole of what this item claims.
const QUIET_TICKS = 3 * SECOND;

export default function item() {
  // The tower and unit followed, and the board after the quiet half second.
  let towerId;
  let u;
  let s;
  let t;
  let live;

  return {
    id: "towers.regulator-nonfiring",

    async arrange(api) {
      towerId = await armTower(api, { type: "regulator", tier: 1 });
      [u] = await spawnControlled(api, "mote");
      // Walk the Mote up to the edge of the aura the Regulator projects, so the quiet half
      // second that follows is spent with a unit actually inside its reach — the only way the
      // negative claim means anything.
      await skipToApproach(api, towerId, u.id);
    },

    async act(api) {
      await api.advance(QUIET_TICKS); // well past when a firing tower would have shot

      s = await snap(api);
      t = towerById(s, towerId);
      live = unitById(s, u.id);

      await api.screenshot("regulator");
    },

    async assert(api, check) {
      const hp0 = u.hp;
      check.expectEq("the Regulator has no targeting control", t.targeting, null);
      check.expectEq("...deals no damage", t.damage, 0);
      check.expectEq("...projects an aura instead", t.abilities.includes("aura"), true);
      check.expectGt("...with a real aura radius", t.auraRadius, 0);
      check.expectOk("the head does not rotate", t.heading === 0);
      check.expectOk("no projectile is fired", s.projectiles.length === 0);
      check.expectEq("the unit in range is unharmed by the Regulator", live ? live.hp : hp0, hp0);
      check.expectEq("the Regulator still occupies the board (it walls)", t.kind, "component");
    },
  };
}
