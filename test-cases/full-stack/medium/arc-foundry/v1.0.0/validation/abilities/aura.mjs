// Automated validation for abilities.aura: a Regulator's aura multiplies the damage of a
// firing tower whose center lies within its radius by (1 + auraBonus); the aura source never
// buffs itself.
//
// A standing capacitor is kept (its wave cleared), then a Regulator is kept adjacent so its
// aura covers the capacitor. The capacitor's effective damage must exceed its base (6) — a
// T1 Regulator's +10% takes it to 7 — while the Regulator itself deals no damage.

import { startBuild, placeCandidate, towerById, snap, clearWave, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("abilities.aura");

  await startBuild(api);
  await api.call("setIntegrity", 999);

  const cap = await placeCandidate(api, "capacitor", 1, 2, 7);
  await api.call("keep", cap.id); // Wave 1
  await clearWave(api, 200); // reopen build

  const reg = await placeCandidate(api, "regulator", 1, 4, 9); // its aura covers the capacitor
  await api.call("keep", reg.id); // Wave 2 — beginWave recomputes auras

  const s = await snap(api);
  const capT = towerById(s, cap.id);
  const regT = towerById(s, reg.id);

  check.expectGt("the aura buffs the covered tower's damage above its base (6)", capT.damage, 6);
  check.expectEq("...to +10% at T1 (6 -> 7)", capT.damage, 7);
  check.expectOk("the Regulator projects an aura", regT.abilities.includes("aura") && regT.auraRadius > 0);
  check.expectEq("the aura source deals no damage itself (no self-buff to speak of)", regT.damage, 0);

  await liveClip(api);
  return check.verdict();
}
