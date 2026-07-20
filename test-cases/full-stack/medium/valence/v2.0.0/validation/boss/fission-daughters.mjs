// Automated validation for the Boss sub-item `fission-daughters`.
//
// Cracking the Macromass is a fission chain, not a health bar, and the daughters are what
// makes it one. Six of its 55 decay steps put a DAUGHTER on the path: a lighter but still
// radioactive Isotope, which is heavy in its own right — energy does nothing to it — and
// which decays into its own alpha and beta particles as it in turn is cracked. That is
// what forces a kinetic/nuclear line to be held against a cascade while the strippers
// behind it clear the loose particles.
//
// The check proves all three properties of a daughter against the real simulation:
//
//   1. Fission sheds them. Driving the boss all the way down releases exactly the six
//      daughters its chain names, each born a full Isotope (9 shells).
//   2. A daughter is heavy. The board is stripped bare the moment the first daughter
//      appears and an ENERGY tower is put over it: its shells do not move, and the tower
//      never even acquires it.
//   3. A daughter decays. A kinetic battery is then put on that same daughter, and the
//      atoms it emits are attributed to it by position — credited only while it is
//      unambiguously the nearest heavy — until it is finally neutralized.

import { stepUntil, unitById, towerById, pathGeom, placeCovering, battery, liveClip, FIXED } from "../_helpers.mjs";
import { bossUnderFire, clearBoard, BOSS_DAUGHTERS, ISOTOPE_SHELLS } from "./_boss.mjs";

const MAX_FISSION_SECONDS = 150; // generous: game time on the manual clock, not wall clock
const MAX_DECAY_SECONDS = 40;
const ENERGY_SECONDS = 4;
const CREDIT_RADIUS = 60; // a decay particle is emitted just behind its parent

const isDaughter = (u, bossId) => u.type === "isotope" && u.id !== bossId;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("boss.fission-daughters");

  // ---- 1. Fission sheds daughter isotopes ------------------------------------
  const { g, bossId } = await bossUnderFire(api);
  const daughters = new Map(); // id -> the snapshot it was first seen in
  const r = await stepUntil(api, (s) => {
    for (const u of s.matter) if (isDaughter(u, bossId) && !daughters.has(u.id)) daughters.set(u.id, u);
    return unitById(s, bossId) == null;
  }, MAX_FISSION_SECONDS, 0.05);

  check.expectOk("the boss was cracked all the way down", r.hit);
  check.expectEq("its fission chain sheds exactly six daughter isotopes", daughters.size, BOSS_DAUGHTERS);
  const born = [...daughters.values()];
  check.expectOk("every daughter is heavy in its own right", born.every((u) => u.traits.heavy === true));
  check.expectOk("no daughter arrives bonded — it is a bare isotope", born.every((u) => u.traits.bonded === false));
  check.expectOk("each is born a full Isotope of 9 shells", born.every((u) => u.maxHp === ISOTOPE_SHELLS));

  // ---- 2. A daughter is energy-immune ----------------------------------------
  // Re-run to the FIRST daughter, then strip the board so nothing else is firing.
  const second = await bossUnderFire(api);
  let firstDaughterId = null;
  await stepUntil(api, (s) => {
    const d = s.matter.find((u) => isDaughter(u, second.bossId));
    if (d) firstDaughterId = d.id;
    return firstDaughterId != null;
  }, MAX_FISSION_SECONDS, 0.05);
  check.expectOk("a daughter was released to test on its own", firstDaughterId != null);

  await clearBoard(api);
  await api.call("setEnergy", 100000);
  const g2 = pathGeom((await api.snapshot()).paths[0]);
  const at = unitById(await api.snapshot(), firstDaughterId);
  const emitter = await placeCovering(api, "emitter", g2, at.progress + 40);
  const hpBefore = unitById(await api.snapshot(), firstDaughterId).hp;

  let everTargeted = false;
  let everInRange = false;
  for (let i = 0; i < Math.round(ENERGY_SECONDS * 60); i += 1) {
    await api.step(FIXED);
    const s = await api.snapshot();
    const u = unitById(s, firstDaughterId);
    if (u == null) break;
    const tw = towerById(s, emitter.id);
    if (tw.targetId === firstDaughterId) everTargeted = true;
    if (Math.hypot(u.x - tw.x, u.y - tw.y) <= tw.range) everInRange = true;
  }
  const afterEnergy = unitById(await api.snapshot(), firstDaughterId);
  check.expectOk("the daughter passed through the energy tower's range", everInRange);
  check.expectOk("the daughter survived the energy tower", afterEnergy != null);
  check.expectEq("energy damage does nothing to a daughter", afterEnergy.hp, hpBefore);
  check.expectOk("the energy tower never even targets a daughter", everTargeted === false);

  // ---- 3. A daughter decays into its own particles ----------------------------
  await clearBoard(api);
  await api.call("setEnergy", 100000);
  const from = unitById(await api.snapshot(), firstDaughterId).progress;
  await battery(api, "cleaver", g2, from + 30, Math.min(g2.length - 30, from + 400), 3);

  const known = new Set((await api.snapshot()).matter.map((u) => u.id));
  let alpha = 0;
  let beta = 0;
  const decay = await stepUntil(api, (s) => {
    const d = unitById(s, firstDaughterId);
    for (const u of s.matter) {
      if (known.has(u.id)) continue;
      known.add(u.id);
      if (u.type !== "atom" || d == null) continue;
      // Credit an emission to this daughter only when the daughter is unambiguously the
      // heavy it came off: close by, and closer than any other heavy on the board.
      const dist = Math.hypot(u.x - d.x, u.y - d.y);
      if (dist > CREDIT_RADIUS || u.pathId !== d.pathId) continue;
      const nearerHeavy = s.matter.some(
        (o) => o.id !== d.id && o.traits.heavy && Math.hypot(u.x - o.x, u.y - o.y) <= dist,
      );
      if (nearerHeavy) continue;
      if (u.electrons >= 6) alpha += 1;
      if (u.electrons === 2) beta += 1;
    }
    return d == null;
  }, MAX_DECAY_SECONDS, FIXED);

  check.expectOk("the daughter was cracked down and neutralized", decay.hit);
  check.expectGe("a daughter emits its own alpha particles as it decays", alpha, 1);
  check.expectGe("a daughter emits its own beta particle as it decays", beta, 1);

  await liveClip(api, 1400);
  return check.verdict();
}
