// Automated validation for the Economy sub-item `buffer-pays-on-break`.
//
// A bonded cluster's bond pool is a health buffer in front of its atoms. Chipping that
// buffer pays nothing while it drains; breaking through pays the pool's whole value at
// once, and damage past the last point of the pool pays nothing on top. The check drains a
// cluster with a real tower, reads the payout at every step, and confirms the whole payout
// arrives on the breaking hit and totals exactly the pool.

import { coverAndSpawn, stepUntil, liveClip } from "../_helpers.mjs";

const unitById = (snap, id) => snap.matter.find((u) => u.id === id);

// Drain a covered cluster to the moment its bond pool breaks, recording what was paid
// while the pool was still up and what the breaking hit itself paid.
async function drainCluster(api, { kind, type }) {
  const { unitId } = await coverAndSpawn(api, { kind, type });
  await api.call("setEnergy", 0);

  const start = await api.snapshot();
  const maxBond = unitById(start, unitId).maxBond;

  let paidWhileDraining = 0;
  let prevEnergy = start.energy;
  let prevBond = maxBond;

  // Step until the pool is gone, tracking payouts against the bond that was still up.
  const r = await stepUntil(
    api,
    (s) => {
      const u = unitById(s, unitId);
      const bond = u?.bond ?? 0;
      if (bond > 0 && s.energy !== prevEnergy) paidWhileDraining += s.energy - prevEnergy;
      prevEnergy = s.energy;
      prevBond = bond;
      return bond <= 0;
    },
    12,
    1 / 60,
  );

  return {
    broke: r.hit,
    maxBond,
    paidWhileDraining,
    totalPaid: r.snap.energy,
    bondBeforeBreak: prevBond,
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
  check.expectEq("chipping the larger pool pays nothing while it drains", overkill.paidWhileDraining, 0);
  check.expectEq(
    "a breaking hit that overkills the pool still pays only the pool",
    overkill.totalPaid,
    overkill.maxBond,
  );

  await liveClip(api, 800);
  return check.verdict();
}
