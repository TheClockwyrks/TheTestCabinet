// Automated validation for towers.projectile-carries-hit: every shot is a visible traveling
// projectile that carries the hit on impact — the shot is in flight before the target loses
// HP, so damage lands on arrival, not at the instant of firing (not hitscan).
//
// Arming the Discharge and releasing the Slug are control ops (the arrange). The two-stage
// measurement — a bolt exists and the target is UNHARMED, then the target is harmed — is the
// behavior under test and is the act. It is also exactly the right clip: a reviewer watches one
// heavy bolt cross the gap and land.

import { armTower, spawnControlled, unitById, snap, TICK, SECOND } from "../_helpers.mjs";

export default function item() {
  // The unit followed, and the two stages of the shot.
  let u;
  let launched;
  let hpInFlight;
  let landed;

  return {
    id: "towers.projectile-carries-hit",

    async arrange(api) {
      await armTower(api, { type: "discharge", tier: 1 }); // a heavy, single traveling bolt
      [u] = await spawnControlled(api, "slug");
    },

    async act(api) {
      const hp0 = u.hp;

      // A projectile is launched and travels before it reaches the target. 0.3 s = 18 ticks,
      // read every tick — the bolt must be caught WHILE it is still in flight, and one tick
      // later it may already have landed, which would defeat the whole check.
      launched = await api.until((s) => s.projectiles.length > 0, { max: 0.3 * SECOND, poll: TICK });
      hpInFlight = unitById(await snap(api), u.id).hp;

      // The hit lands only when the projectile reaches the target. 0.6 s = 36 ticks.
      landed = await api.until(
        (s) => {
          const l = unitById(s, u.id);
          return l && l.hp < hp0;
        },
        { max: 0.6 * SECOND, poll: TICK },
      );
    },

    async assert(api, check) {
      check.expectOk("a projectile is launched and travels", launched.hit);
      check.expectEq("the target has not lost HP while the shot is still in flight", hpInFlight, u.hp);
      check.expectOk("the hit lands only on impact (not hitscan)", landed.hit);
    },
  };
}
