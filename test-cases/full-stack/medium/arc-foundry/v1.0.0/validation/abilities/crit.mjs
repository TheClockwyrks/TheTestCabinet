// Automated validation for abilities.crit: a crit-carrying combination tower can land a shot
// dealing x critMult damage; base components never crit.
//
// A Slag Driver (crit combo) is assembled and fires at a high-HP Overload Dynamo (kept as the
// strongest target so every shot lands on it). Across seeds and shots we look for a projectile
// whose damage exceeds the tower's normal per-shot damage — a crit. Each seed is a fresh,
// deterministic run, so the search is reproducible.

import { assembleCombo, spawnControlled, towerById, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("abilities.crit");

  let found = false;
  let critDmg = 0;
  let baseDmg = 0;

  for (let seed = 1; seed <= 12 && !found; seed += 1) {
    const { comboId } = await assembleCombo(api, "slagdriver", { seed, charge: 400 });
    if (comboId == null) continue;
    await api.call("setTargeting", comboId, "strongest");
    await spawnControlled(api, "dynamo", { wave: 20 }); // huge HP: survives the search, always strongest
    baseDmg = towerById(await snap(api), comboId).damage; // level-0 Slag Driver base per-shot damage
    const thresh = baseDmg * 1.5; // a crit is x2, so > 1.5x base cleanly separates it

    const r = await stepUntil(api, (s) => s.projectiles.some((p) => p.damage >= thresh), 5, 1 / 60);
    if (r.hit) {
      found = true;
      const s = await snap(api);
      critDmg = Math.max(...s.projectiles.map((p) => p.damage));
      await liveClip(api, 1500);
    }
  }

  check.expectOk("a combination tower landed a critical hit (a shot dealt more than a normal shot)", found);
  check.expectGt("the crit shot's damage exceeds the base per-shot damage", critDmg, baseDmg);

  return check.verdict();
}
