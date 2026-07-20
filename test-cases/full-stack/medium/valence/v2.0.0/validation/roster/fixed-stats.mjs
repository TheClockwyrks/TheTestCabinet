// Automated validation for the Roster sub-item `fixed-stats`.
//
// Every matter type is the same unit in every round. Its shells, bond pool, speed, and
// leak value are fixed by the roster and never scale with the round number: a Dimer in
// Round 20 is the identical unit to a Dimer in Round 38. Difficulty lives entirely in the
// round table — in what a row sends and how much of it — so nothing about a unit may
// change underneath the player between one round and a later one.
//
// The check reads units the REAL wave system released, not posed ones, so it is the round
// pipeline being checked and not just the roster table: it starts an early and a late
// round that both field the same type and compares the first unit of that type each one
// puts on the board. The absolute values are pinned too, so a build that scaled every
// round equally could not pass by being merely self-consistent.

import { startRun, stepUntil, liveClip, MAP } from "../_helpers.mjs";

const MAX_WAVE_SECONDS = 90; // generous: game time on the manual clock, not wall clock

// The roster's fixed stats for the two types compared (specs/matter.md).
const DIMER = { maxBond: 5, baseSpeed: 50 };
const ISOTOPE = { maxHp: 9, baseSpeed: 36 };

// Start `round` and return the first unit of `type` the real wave system releases.
async function firstOfType(api, round, type) {
  await startRun(api, MAP.single, { round, integrity: 1e9 });
  await api.call("startRound");
  let found = null;
  await stepUntil(api, (s) => {
    const u = s.matter.find((m) => m.type === type);
    if (u && found == null) found = u;
    return found != null;
  }, MAX_WAVE_SECONDS, 0.05);
  return found;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("roster.fixed-stats");

  // Dimers arrive first in Round 20 and again in Round 38, eighteen rounds later.
  const earlyDimer = await firstOfType(api, 20, "dimer");
  const lateDimer = await firstOfType(api, 38, "dimer");
  check.expectOk("an early round released a Dimer to compare", earlyDimer != null);
  check.expectOk("a late round released a Dimer to compare", lateDimer != null);
  check.expectEq("an early Dimer's bond pool is the roster's 5", earlyDimer.maxBond, DIMER.maxBond);
  check.expectEq("a late Dimer's bond pool is unchanged", lateDimer.maxBond, DIMER.maxBond);
  check.expectEq("an early Dimer's speed is the roster's 50", earlyDimer.baseSpeed, DIMER.baseSpeed);
  check.expectEq("a late Dimer's speed is unchanged", lateDimer.baseSpeed, DIMER.baseSpeed);

  // Isotopes arrive in Round 26 and again in Round 39.
  const earlyIsotope = await firstOfType(api, 26, "isotope");
  const lateIsotope = await firstOfType(api, 39, "isotope");
  check.expectOk("an early round released an Isotope to compare", earlyIsotope != null);
  check.expectOk("a late round released an Isotope to compare", lateIsotope != null);
  check.expectEq("an early Isotope carries the roster's 9 shells", earlyIsotope.maxHp, ISOTOPE.maxHp);
  check.expectEq("a late Isotope carries the same 9 shells", lateIsotope.maxHp, ISOTOPE.maxHp);
  check.expectEq("an early Isotope's speed is the roster's 36", earlyIsotope.baseSpeed, ISOTOPE.baseSpeed);
  check.expectEq("a late Isotope's speed is unchanged", lateIsotope.baseSpeed, ISOTOPE.baseSpeed);

  await liveClip(api, 1000);
  return check.verdict();
}
