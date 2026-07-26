// Automated validation for abilities.crit: a crit-carrying combination tower can land a shot
// dealing x critMult damage; base components never crit.
//
// A Slag Driver (crit combo) is assembled and fires at a high-HP Overload Dynamo (kept as the
// strongest target so every shot lands on it). Across shots we look for a projectile whose
// damage exceeds the tower's normal per-shot damage — a crit.
//
// The old script searched by RE-SEEDING: twelve fresh runs, each given 5 s to produce a crit.
// That is no longer expressible — re-seeding means `reset`, and `reset` from `act` would hand
// the build back to its manual clock and silently freeze the recording. So the search runs on
// the single seeded run the arrange poses and buys its crit rolls with TIME rather than with
// seeds: each round releases a fresh Dynamo and watches for 5 s. The fresh Dynamo per round is
// not padding — the Slag Driver's range is 175 px and a Dynamo walks at 30 px/s, so a single
// target leaves the firing envelope in about six seconds and the search would otherwise stall
// with nothing to shoot at. `strongest` targeting keeps the head on the newest, undamaged one.
// Twelve rounds at the Slag Driver's 0.6 shots/s is ~36 crit rolls at p = 0.25, so a build that
// can crit will, and the run is still a single deterministic seed.

import { assembleCombo, spawnControlled, towerById, snap, TICK, SECOND } from "../_helpers.mjs";

// How many rounds to search, and how long each round watches (one fresh Dynamo per round).
const ROUNDS = 12;
const ROUND_TICKS = 5 * SECOND; // 300 ticks

export default function item() {
  // The assembled combo, whether a crit was seen, and the two damages compared by `assert`.
  let comboId;
  let found = false;
  let critDmg = 0;
  let baseDmg = 0;

  return {
    id: "abilities.crit",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "slagdriver", { seed: 1, charge: 400 }));
      if (comboId == null) return;
      await api.call("setTargeting", comboId, "strongest");
      // The level-0 Slag Driver's base per-shot damage, read before a shot is ever fired.
      baseDmg = towerById(await snap(api), comboId).damage;
    },

    async act(api) {
      if (comboId == null) return;
      const thresh = baseDmg * 1.5; // a crit is x2, so > 1.5x base cleanly separates it

      for (let round = 0; round < ROUNDS && !found; round += 1) {
        // A fresh, undamaged Dynamo at the Entry: huge HP, and `strongest` puts the head on it.
        await spawnControlled(api, "dynamo", { wave: 20 });
        // A projectile is transient, so the sweep reads every tick or a crit passes between polls.
        const r = await api.until((s) => s.projectiles.some((p) => p.damage >= thresh), {
          max: ROUND_TICKS,
          poll: TICK,
        });
        if (r.hit) {
          found = true;
          const s = await snap(api);
          critDmg = Math.max(...s.projectiles.map((p) => p.damage));
        }
      }
    },

    async assert(api, check) {
      check.expectOk("a combination tower landed a critical hit (a shot dealt more than a normal shot)", found);
      check.expectGt("the crit shot's damage exceeds the base per-shot damage", critDmg, baseDmg);
    },
  };
}
