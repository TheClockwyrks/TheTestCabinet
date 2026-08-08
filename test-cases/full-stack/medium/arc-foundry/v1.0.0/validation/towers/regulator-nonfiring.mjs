// Automated validation for towers.regulator-nonfiring: the Regulator is a non-firing support
// node — it never fires, launches no projectile, does not rotate a head or damage a unit in
// range, and only projects an aura.
//
// Arming the Regulator and releasing the Mote are control ops (the arrange). The claim is a
// NEGATIVE — that nothing happens — so the act is the three seconds of nothing happening, which
// is also the only honest clip: a unit walks straight through the Regulator's range untouched.
//
// WHY "THE HEAD DOES NOT ROTATE" IS NOW MEASURED AS A CHANGE. It used to be asserted as
// `heading === 0`, read once at the end of the act — which is not the claim. `heading` is a
// bearing, and nothing in `specs/towers.md` or `specs/instrumentation.md` says a piece that never
// turns must report zero: a Regulator drawn facing down the yard reports that bearing and holds
// it forever, which is exactly the behavior this item wants. One run implementation failed here
// while doing precisely that. Rotation is a CHANGE in the bearing, so it is measured as one: the
// heading is read as the act opens and again after a unit has walked all the way through the
// aura, and the two must be the same. A build whose head tracks the unit fails; a build whose
// head simply points somewhere does not.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  towerById,
  unitById,
  angDiff,
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
  let heading0;

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
      // The bearing before the unit crosses the aura, to compare the one after it against.
      heading0 = towerById(await snap(api), towerId)?.heading ?? 0;

      await api.advance(QUIET_TICKS); // well past when a firing tower would have shot

      s = await snap(api);
      t = towerById(s, towerId);
      live = unitById(s, u.id);
    },

    async assert(api, check) {
      const hp0 = u.hp;
      check.expectEq("the Regulator has no targeting control", t.targeting, null);
      check.expectEq("...deals no damage", t.damage, 0);
      check.expectEq("...projects an aura instead", t.abilities.includes("aura"), true);
      check.expectGt("...with a real aura radius", t.auraRadius, 0);
      // Rotation is a change of bearing, not a particular bearing: a Regulator that simply faces
      // one way and holds it is doing what this item asks.
      check.expectClose(
        "the head does not rotate (its bearing is unchanged after a unit crossed the aura)",
        angDiff(t.heading, heading0),
        0,
        1e-6,
      );
      check.expectOk("no projectile is fired", s.projectiles.length === 0);
      check.expectEq("the unit in range is unharmed by the Regulator", live ? live.hp : hp0, hp0);
      check.expectEq("the Regulator still occupies the board (it walls)", t.kind, "component");
    },
  };
}
