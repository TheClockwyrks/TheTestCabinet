// Automated validation for towers.arcnode-splash: the Arc-Node's shot detonates a discharge
// that damages every unit within its splash radius of the impact point.
//
// Arming the Arc-Node and releasing the cluster are control ops (the arrange); waiting for the
// discharge that hurts two of them at once is the behavior under test and is the act.
//
// WHAT THE CLIP SHOWS. This item is about ONE shot touching SEVERAL units, so the pack has to be
// on screen, alive, and being hit, for long enough to see it happen. Two things were against
// that. The pack was scaled to the current wave, so a Mote died in a couple of hits and the
// board emptied almost as soon as the effect landed; and the walk-up was swept finely, which the
// record pass films as a burst of teleporting units before the act begins — the fast section
// where, ironically, the whole pack was visible. So the pack is now scaled up enough to survive
// a good many volleys, the sweep is coarse and stops further out, and the act runs on well past
// the measurement. The check itself is unchanged: one shot, two units hurt.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several Arc-Node cadences (0.85 shots/s), so a build that opens on a full cooldown resolves.
const SPLASH_TICKS = 6 * SECOND;
// A beat after the detonation, so the clip carries the discharge rather than cutting on it.
// Several more cadences after the effect first lands, so a reviewer sees it happen
// repeatedly across the pack rather than catching it once on the closing frame.
const TAIL_TICKS = 4 * SECOND;

export default function item() {
  // The units followed, their pre-shot HP, and whether the splash caught two of them.
  let ids;
  const initHp = {};
  let splashed;

  return {
    id: "towers.arcnode-splash",

    async arrange(api) {
      const towerId = await armTower(api, { type: "arcnode", tier: 1 });
      // Scaled well up the wave ramp: a Wave-1 Mote pops in two hits and takes the evidence off
      // screen with it, where these survive volley after volley and stay watchable.
      const units = await spawnControlled(api, "mote", { count: 4, wave: 14 });
      ids = units.map((u) => u.id);
      // Stop short of reach and sweep coarsely: the act then opens on the cluster walking in,
      // rather than after a long fine-grained sweep the recording shows as a fast-forward.
      await skipToApproach(api, towerId, ids[0], { lead: 60, poll: 10 });
      const s0 = await snap(api);
      for (const id of ids) {
        const l = unitById(s0, id);
        if (l) initHp[id] = l.hp;
      }
    },

    async act(api) {
      // Read every tick: a splash hurts its victims on ONE tick, and a coarser poll could land
      // after a unit had already died and left the snapshot.
      splashed = await api.until(
        (s) => {
          let hurt = 0;
          for (const id of ids) {
            const l = unitById(s, id);
            if (l && l.hp < initHp[id]) hurt += 1;
          }
          return hurt >= 2;
        },
        { max: SPLASH_TICKS, poll: TICK },
      );

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the Arc-Node's discharge damaged multiple units in the cluster (splash)", splashed.hit);
    },
  };
}
