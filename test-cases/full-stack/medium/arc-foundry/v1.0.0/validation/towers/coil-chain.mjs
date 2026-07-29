// Automated validation for towers.coil-chain: the Coil's bolt leaps from the struck unit to
// nearby extra units, so one shot damages several units in a pack.
//
// Arming the Coil and releasing the pack are control ops (the arrange); waiting for the bolt
// that forks through two of them is the behavior under test and is the act.
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

// Several Coil cadences (1.0 shots/s), so a build that opens on a full cooldown still resolves.
const CHAIN_TICKS = 6 * SECOND;
// A beat after the fork, so the clip carries the leap rather than cutting on it.
// Several more cadences after the effect first lands, so a reviewer sees it happen
// repeatedly across the pack rather than catching it once on the closing frame.
const TAIL_TICKS = 4 * SECOND;

export default function item() {
  // The units followed, their pre-shot HP, and whether the bolt caught two of them.
  let ids;
  const initHp = {};
  let chained;

  return {
    id: "towers.coil-chain",

    async arrange(api) {
      const towerId = await armTower(api, { type: "coil", tier: 1 });
      // Scaled well up the wave ramp: a Wave-1 Mote pops in two hits and takes the evidence off
      // screen with it, where these survive volley after volley and stay watchable.
      const units = await spawnControlled(api, "mote", { count: 4, wave: 14 });
      ids = units.map((u) => u.id);
      // Stop short of reach and sweep coarsely: the act then opens on the pack walking in,
      // rather than after a long fine-grained sweep the recording shows as a fast-forward.
      await skipToApproach(api, towerId, ids[0], { lead: 60, poll: 10 });
      const s0 = await snap(api);
      for (const id of ids) {
        const l = unitById(s0, id);
        if (l) initHp[id] = l.hp;
      }
    },

    async act(api) {
      // Read every tick: a chain lands on ONE tick, and a coarser poll could land after a unit
      // had already died and left the snapshot.
      chained = await api.until(
        (s) => {
          let hurt = 0;
          for (const id of ids) {
            const l = unitById(s, id);
            if (l && l.hp < initHp[id]) hurt += 1;
          }
          return hurt >= 2;
        },
        { max: CHAIN_TICKS, poll: TICK },
      );

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the Coil's bolt chained, damaging at least two units in the pack", chained.hit);
    },
  };
}
