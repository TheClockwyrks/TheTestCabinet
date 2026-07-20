// Automated validation for the Hit Points sub-item `pays-total-shells`.
//
// A unit pays out exactly its TOTAL SHELLS over its lifetime — its own hit points plus
// everything it fragments into — because energy is earned per shell stripped rather than
// as a lump on the kill. The check drives two units all the way down from an empty bank
// and reads the bank at the end:
//
//   * a 3-electron atom, which is 3 shells and nothing else, pays exactly 3;
//   * a Dimer, which is a bond pool of 5 over two atoms of 3, pays exactly 11 — and only
//     once every one of those pieces has itself been stripped.
//
// Score tracks the same amounts, so it is read alongside. Nothing may leak: a unit that
// reaches the collector stops paying, so the check also confirms the board was cleared.

import { startRun, pathGeom, placeCovering, battery, spawnAt, stepUntil, unitById, towerById, firstInRange, liveClip, MAP } from "../_helpers.mjs";

const ATOM3_TOTAL_SHELLS = 3; // a 3-electron atom is 3 shells — specs/matter.md
const DIMER_TOTAL_SHELLS = 11; // bond 5 + 2 atoms of 3 — specs/matter.md
const MAX_CLEAR_SECONDS = 40; // generous: game time on the manual clock

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hitpoints.pays-total-shells");

  // A lone atom under one tower, posed at the upstream edge of its range so it travels
  // the whole in-range window — the dwell needed to strip it all the way down.
  {
    const snap = await startRun(api, MAP.single);
    const g = pathGeom(snap.paths[0]);
    const tower = await placeCovering(api, "emitter", g, g.length * 0.5);
    const s = firstInRange(g, towerById(await api.snapshot(), tower.id));
    const id = await spawnAt(api, { type: "atom", electrons: 3, pathId: 0, s });
    await api.call("setEnergy", 0);
    const before = await api.snapshot();

    const r = await stepUntil(api, (t) => unitById(t, id) == null, MAX_CLEAR_SECONDS, 0.05);
    check.expectOk("the atom was neutralized", r.hit);
    check.expectEq("a 3-electron atom pays its 3 shells", r.snap.energy - before.energy, ATOM3_TOTAL_SHELLS);
    check.expectEq("...and scores the same", r.snap.score - before.score, ATOM3_TOTAL_SHELLS);
  }

  // A Dimer under a battery, so its pool AND both of the atoms it releases are stripped
  // before any of them reaches the collector.
  {
    const snap = await startRun(api, MAP.single);
    const g = pathGeom(snap.paths[0]);
    await battery(api, "cleaver", g, g.length * 0.2, g.length * 0.8, 4);
    const id = await spawnAt(api, { type: "dimer", pathId: 0, s: 0 });
    await api.call("setEnergy", 0);
    const before = await api.snapshot();

    const r = await stepUntil(api, (t) => unitById(t, id) == null && t.matter.length === 0, MAX_CLEAR_SECONDS, 0.05);
    check.expectOk("the cluster and every atom it released were cleared", r.hit);
    check.expectEq("nothing leaked (integrity intact)", r.snap.integrity, before.integrity);
    check.expectEq("a Dimer pays its 11 total shells (pool 5 + two atoms of 3)", r.snap.energy - before.energy, DIMER_TOTAL_SHELLS);
    check.expectEq("...and scores the same", r.snap.score - before.score, DIMER_TOTAL_SHELLS);
  }

  // Clip an atom being paid for as it is stripped.
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, "emitter", g, g.length * 0.5);
  const s = firstInRange(g, towerById(await api.snapshot(), tower.id));
  await spawnAt(api, { type: "atom", electrons: 5, pathId: 0, s });
  await liveClip(api, 1300);
  return check.verdict();
}
