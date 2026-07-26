// Automated validation for abilities.aura: a Regulator's aura multiplies the damage of a
// firing tower whose center lies within its radius by (1 + auraBonus); the aura source never
// buffs itself.
//
// A standing capacitor is kept (its wave cleared), then a Regulator is kept adjacent so its
// aura covers the capacitor. The capacitor's effective damage must exceed its base (6) — a
// T1 Regulator's +10% takes it to 7 — while the Regulator itself deals no damage.
//
// Opening the run, walling in the capacitor and harvesting it are all control ops, so they are
// the arrange. Clearing that wave is the only part that consumes time, so it and everything
// after it — the Regulator placement and keep are instant, but must happen AFTER the build
// phase reopens — live in `act`.

import { startBuild, placeCandidate, towerById, snap, actClearWave, SECOND } from "../_helpers.mjs";

export default function item() {
  // The capacitor id `act` needs once the wave clears, and the two towers as they stood at the
  // start of the Regulator's wave, read by `assert`.
  let capId;
  let capT;
  let regT;

  return {
    id: "abilities.aura",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);

      const cap = await placeCandidate(api, "capacitor", 1, 2, 7);
      capId = cap.id;
      await api.call("keep", cap.id); // Wave 1
    },

    async act(api) {
      await actClearWave(api, { maxTicks: 200 * SECOND }); // reopen build

      const reg = await placeCandidate(api, "regulator", 1, 4, 9); // its aura covers the capacitor
      await api.call("keep", reg.id); // Wave 2 — beginWave recomputes auras

      const s = await snap(api);
      capT = towerById(s, capId);
      regT = towerById(s, reg.id);
    },

    async assert(api, check) {
      check.expectGt("the aura buffs the covered tower's damage above its base (6)", capT.damage, 6);
      check.expectEq("...to +10% at T1 (6 -> 7)", capT.damage, 7);
      check.expectOk("the Regulator projects an aura", regT.abilities.includes("aura") && regT.auraRadius > 0);
      check.expectEq("the aura source deals no damage itself (no self-buff to speak of)", regT.damage, 0);
    },
  };
}
