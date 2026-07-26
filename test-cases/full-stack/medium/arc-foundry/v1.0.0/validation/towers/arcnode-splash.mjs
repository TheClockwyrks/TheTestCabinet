// Automated validation for towers.arcnode-splash: the Arc-Node's shot detonates a discharge
// that damages every unit within its splash radius of the impact point.
//
// Arming the Arc-Node and releasing the cluster are control ops (the arrange); waiting for the
// discharge that hurts two of them at once is the behavior under test and is the act.

import { armTower, spawnControlled, unitById, snap, TICK, SECOND } from "../_helpers.mjs";

export default function item() {
  // The units followed, their pre-shot HP, and whether the splash caught two of them.
  let ids;
  const initHp = {};
  let splashed;

  return {
    id: "towers.arcnode-splash",

    async arrange(api) {
      await armTower(api, { type: "arcnode", tier: 1 });
      const units = await spawnControlled(api, "mote", { count: 3 }); // a cluster at the Entry
      ids = units.map((u) => u.id);
      const s0 = await snap(api);
      for (const id of ids) {
        const l = unitById(s0, id);
        if (l) initHp[id] = l.hp;
      }
    },

    async act(api) {
      // 0.5 s = 30 ticks, read every tick: a splash hurts its victims on ONE tick, and a coarser
      // poll could land after a unit had already died and left the snapshot.
      splashed = await api.until(
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
      check.expectOk("the Arc-Node's discharge damaged multiple units in the cluster (splash)", splashed.hit);
    },
  };
}
