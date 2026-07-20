// Automated validation for the Economy sub-item `buffer-pays-on-break`.
//
// A bonded cluster's bond pool is a health buffer in front of its atoms. Chipping that
// buffer pays nothing while it drains; breaking through pays the pool's whole value at
// once, and damage past the last point of the pool pays nothing on top. The check drains
// a cluster with a real tower, reads the payout at every fixed step, and confirms the
// whole payout arrives on the breaking hit and totals exactly the pool.
//
// Two isolations make the reading honest. The cluster is posed at the UPSTREAM edge of
// the tower's range so it travels the whole coverage window — enough dwell to actually
// break the pool. And the tower is pointed at the LAST unit in range: a cluster sheds its
// freed atoms just AHEAD of itself, and a tower on the default FIRST priority would drift
// onto them and mix their per-shell payouts into a figure that is supposed to be about
// the pool alone.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, towerById, firstInRange, focusOnParent, liveClip, MAP } from "../_helpers.mjs";

const MAX_DRAIN_SECONDS = 30; // generous: game time on the manual clock, not wall clock

const unitById = (snap, id) => snap.matter.find((u) => u.id === id);

// Drain a covered cluster to the moment its bond pool breaks, recording what was paid
// while the pool was still up and what the breaking hit itself paid.
async function drainCluster(api, { kind, type }) {
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, kind, g, g.length * 0.4);
  await focusOnParent(api);
  const s = firstInRange(g, towerById(await api.snapshot(), tower.id));
  const unitId = await spawnAt(api, { type, pathId: 0, s });
  await api.call("setEnergy", 0);

  const start = await api.snapshot();
  const maxBond = unitById(start, unitId).maxBond;

  let paidWhileDraining = 0;
  let prevEnergy = start.energy;
  let lastPositiveBond = maxBond; // the pool the FINAL, breaking hit landed on

  // Step until the pool is gone, tracking payouts against the bond that was still up.
  const r = await stepUntil(
    api,
    (t) => {
      const u = unitById(t, unitId);
      const bond = u?.bond ?? 0;
      if (bond > 0 && t.energy !== prevEnergy) paidWhileDraining += t.energy - prevEnergy;
      prevEnergy = t.energy;
      if (bond > 0) lastPositiveBond = bond;
      return bond <= 0;
    },
    MAX_DRAIN_SECONDS,
    1 / 60,
  );

  return {
    broke: r.hit,
    maxBond,
    paidWhileDraining,
    totalPaid: r.snap.energy,
    bondBeforeBreak: lastPositiveBond,
  };
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.buffer-pays-on-break");

  // An Emitter strips 1 a shot, so it chips a Dimer's pool a point at a time and the pool
  // runs out exactly, with no damage wasted.
  const exact = await drainCluster(api, { kind: "emitter", type: "dimer" });
  check.expectOk("the cluster's bond pool is broken through", exact.broke);
  check.expectEq("chipping the pool pays nothing while it drains", exact.paidWhileDraining, 0);
  check.expectEq("breaking the pool pays its whole value", exact.totalPaid, exact.maxBond);

  // A Cleaver hits a bond pool for more than one point, so its last hit lands on a pool
  // with less left than the hit removes. The overkill must not be paid for.
  const overkill = await drainCluster(api, { kind: "cleaver", type: "polymer" });
  check.expectOk("the larger pool is broken through", overkill.broke);
  // A Cleaver hits a bond pool for 4 (its damage of 2, doubled by the kinetic bond bonus).
  check.expectLt("the breaking hit lands on less pool than the hit removes", overkill.bondBeforeBreak, 4);
  check.expectEq("chipping the larger pool pays nothing while it drains", overkill.paidWhileDraining, 0);
  check.expectEq(
    "a breaking hit that overkills the pool still pays only the pool",
    overkill.totalPaid,
    overkill.maxBond,
  );

  await liveClip(api, 800);
  return check.verdict();
}
