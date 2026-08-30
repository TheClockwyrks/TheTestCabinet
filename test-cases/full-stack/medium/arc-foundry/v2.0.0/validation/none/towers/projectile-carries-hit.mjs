// Automated validation for towers.projectile-carries-hit: every shot is a visible traveling
// projectile that carries the hit on impact — the shot is in flight before the target loses
// HP, so damage lands on arrival, not at the instant of firing (not hitscan).
//
// `armTower` leaves a Discharge Rig — a heavy, single traveling bolt — standing on an empty
// floor, and the Slug's walk to the edge of its reach is skipped. The two-stage measurement
// (a bolt exists and the target is UNHARMED, then the target is harmed) is the behavior under
// test and is the act. It is also exactly the right clip: a reviewer watches the Slug close
// the gap, one heavy bolt leave the head, cross it, and land.
//
// As with `auto-fire`, the priority is pinned to `strongest` on a floor holding only the
// Slug. Left on the default `first` with the level's own Wave 1 walking the same corridor,
// the tower would launch its bolt at a wave unit: "a projectile is launched" passed, "the
// target has not lost HP while the shot is still in flight" passed VACUOUSLY (the target was
// never being shot at), and only the impact assertion failed — on a build whose projectiles
// carry their hit perfectly well. The budgets also now cover a Discharge Rig's own cadence,
// which at 0.5 shots/s is one shot every 2 s — four times the window this check used to allow
// for the first bolt to appear at all.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Longer than a Discharge Rig's 2 s cadence, so the first bolt is caught however the build
// phases its opening cooldown.
const LAUNCH_TICKS = 3 * SECOND;
// The bolt's own flight across the gap, generously.
const IMPACT_TICKS = 2 * SECOND;
// A beat after the impact, so the clip carries the landing.
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // The unit followed, and the two stages of the shot.
  let u;
  let approached;
  let hp0;
  let launched;
  let hpInFlight;
  let landed;

  return {
    id: "towers.projectile-carries-hit",

    async arrange(api) {
      const towerId = await armTower(api, { type: "discharge", tier: 1 });
      await api.call("setTargeting", towerId, "strongest");
      [u] = await spawnControlled(api, "slug");
      approached = await skipToApproach(api, towerId, u.id);
      hp0 = unitById(await snap(api), u.id).hp;
    },

    async act(api) {
      // A projectile is launched and travels before it reaches the target. Read every tick —
      // the bolt must be caught WHILE it is still in flight, and one tick later it may already
      // have landed, which would defeat the whole check.
      launched = await api.until((s) => s.projectiles.length > 0, {
        max: LAUNCH_TICKS,
        poll: TICK,
      });
      hpInFlight = unitById(await snap(api), u.id)?.hp ?? hp0;

      // The hit lands only when the projectile reaches the target.
      landed = await api.until(
        (s) => {
          const l = unitById(s, u.id);
          return l && l.hp < hp0;
        },
        { max: IMPACT_TICKS, poll: TICK },
      );

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a unit walked into the component's reach", approached.hit);
      check.expectOk("a projectile is launched and travels", launched.hit);
      check.expectEq("the target has not lost HP while the shot is still in flight", hpInFlight, hp0);
      check.expectOk("the hit lands only on impact (not hitscan)", landed.hit);
    },
  };
}
