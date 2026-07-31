// Automated validation for towers.auto-fire: a firing component fires automatically at a
// valid in-range unit with no manual trigger, and the unit takes HP loss.
//
// `armTower` leaves a Capacitor standing on an empty floor, a Slug is released at the Entry,
// and the walk that carries it to the edge of the tower's reach is skipped. Nothing is then
// done to the tower at all — which is the point — so the act is purely waiting, and the clip
// shows the Slug close the last stretch and the tower open fire on its own.
//
// Two things this check used to get wrong, both of which let it fail a conformant build:
//
//   * It measured inside 0.5 s, which is shorter than a Capacitor's own cadence (1.6 shots/s
//     is one shot every 0.625 s). A build that starts a component on a full cooldown rather
//     than firing on its opening tick had not fired yet — and nothing in `specs/towers.md`
//     says which of those a component does. The budget now covers several cadences.
//   * It left the tower on the default `first` priority while the level's own Wave 1 walked
//     the same corridor, so the tower could perfectly well be firing — at a wave unit. The
//     floor is empty now (see `armTower`), and the priority is pinned to `strongest` with a
//     Slug as the only unit, so the tower has exactly one thing to shoot.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several Capacitor cadences (1.6 shots/s), so a build that opens on a full cooldown still
// resolves well inside the budget.
const FIRE_TICKS = 4 * SECOND;
// A beat after the hit, so the clip carries the impact rather than cutting on it.
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // The unit followed, its pre-shot HP, whether it was hit, and its HP after.
  let u;
  let approached;
  let hp0;
  let fired;
  let hpAfter;

  return {
    id: "towers.auto-fire",

    async arrange(api) {
      const towerId = await armTower(api, { type: "capacitor", tier: 1 });
      await api.call("setTargeting", towerId, "strongest");
      [u] = await spawnControlled(api, "slug"); // high HP: survives to be read
      approached = await skipToApproach(api, towerId, u.id);
      hp0 = unitById(await snap(api), u.id).hp;
    },

    async act(api) {
      fired = await api.until(
        (s) => {
          const l = unitById(s, u.id);
          return l && l.hp < hp0;
        },
        { max: FIRE_TICKS, poll: TICK },
      );
      hpAfter = unitById(await snap(api), u.id)?.hp ?? hp0;

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a unit walked into the component's reach", approached.hit);
      check.expectOk("the component fired on its own and damaged the in-range unit", fired.hit);
      check.expectLt("the unit lost HP with no manual trigger", hpAfter, hp0);
    },
  };
}
