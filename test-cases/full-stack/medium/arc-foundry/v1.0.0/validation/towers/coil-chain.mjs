// Automated validation for towers.coil-chain: the Coil's bolt leaps from the struck unit to
// nearby extra units, so one shot damages several units in a pack.
//
// Arming the Coil and releasing the pack are control ops (the arrange); waiting for the bolt
// that forks through two of them is the behavior under test and is the act.

import { armTower, spawnControlled, unitById, snap, TICK, SECOND } from "../_helpers.mjs";

export default function item() {
  // The units followed, their pre-shot HP, and whether the bolt caught two of them.
  let ids;
  const initHp = {};
  let chained;

  return {
    id: "towers.coil-chain",

    async arrange(api) {
      await armTower(api, { type: "coil", tier: 1 });
      const units = await spawnControlled(api, "mote", { count: 3 }); // a tight pack at the Entry
      ids = units.map((u) => u.id);
      const s0 = await snap(api);
      for (const id of ids) {
        const l = unitById(s0, id);
        if (l) initHp[id] = l.hp;
      }
    },

    async act(api) {
      // 0.5 s = 30 ticks, read every tick: a chain lands on ONE tick, and a coarser poll could
      // land after a unit had already died and left the snapshot.
      chained = await api.until(
        (s) => {
          let hurt = 0;
          for (const id of ids) {
            const l = unitById(s, id);
            if (l && l.hp < initHp[id]) hurt += 1;
          }
          return hurt >= 2;
        },
        { max: 0.5 * SECOND, poll: TICK },
      );
    },

    async assert(api, check) {
      check.expectOk("the Coil's bolt chained, damaging at least two units in the pack", chained.hit);
    },
  };
}
