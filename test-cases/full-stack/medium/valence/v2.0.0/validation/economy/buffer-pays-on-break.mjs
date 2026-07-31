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
//
// TWO runs (the exact drain and the overkill drain); the second is posed inside `act`
// with `poseScenario`, since `api.reset` throws there.

import {
  startScenario,
  poseScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  towerById,
  firstInRange,
  focusOnParent,
  TICK,
  MAP,
} from "../_helpers.mjs";

const MAX_DRAIN_TICKS = 1800; // 1800 ticks = the old 30 s cap — game time, not wall clock

const unitById = (snap, id) => snap.matter.find((u) => u.id === id);

/** Pose a covered cluster with an empty bank; `begin` opens the run. */
async function poseCluster(api, begin, { kind, type }) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, kind, g, g.length * 0.4);
  await focusOnParent(api);
  const s = firstInRange(g, towerById(await api.snapshot(), tower.id));
  const unitId = await spawnAt(api, { type, pathId: 0, s });
  await api.call("setEnergy", 0);

  const start = await api.snapshot();
  return { unitId, start, maxBond: unitById(start, unitId).maxBond };
}

// Drain a posed cluster to the moment its bond pool breaks, recording what was paid
// while the pool was still up and what the breaking hit itself paid.
async function actDrainCluster(api, { unitId, start, maxBond }) {
  let paidWhileDraining = 0;
  let prevEnergy = start.energy;
  let lastPositiveBond = maxBond; // the pool the FINAL, breaking hit landed on

  // Run until the pool is gone, tracking payouts against the bond that was still up.
  // Polled every TICK: the whole point is to attribute each payment to the exact step it
  // arrived on, so no read may be skipped.
  const r = await api.until(
    (t) => {
      const u = unitById(t, unitId);
      const bond = u?.bond ?? 0;
      if (bond > 0 && t.energy !== prevEnergy)
        paidWhileDraining += t.energy - prevEnergy;
      prevEnergy = t.energy;
      if (bond > 0) lastPositiveBond = bond;
      return bond <= 0;
    },
    { max: MAX_DRAIN_TICKS, poll: TICK },
  );

  return {
    broke: r.hit,
    maxBond,
    paidWhileDraining,
    totalPaid: r.snap.energy,
    bondBeforeBreak: lastPositiveBond,
  };
}

export default function item() {
  let posedExact;
  let exact;
  let overkill;

  return {
    id: "economy.buffer-pays-on-break",

    // An Emitter strips 1 a shot, so it chips a Dimer's pool a point at a time and the
    // pool runs out exactly, with no damage wasted. That is the arranged run.
    async arrange(api) {
      posedExact = await poseCluster(api, startScenario, {
        kind: "emitter",
        type: "dimer",
      });
    },

    async act(api) {
      exact = await actDrainCluster(api, posedExact);

      // A Cleaver hits a bond pool for more than one point, so its last hit lands on a
      // pool with less left than the hit removes. The overkill must not be paid for.
      const posedOverkill = await poseCluster(api, poseScenario, {
        kind: "cleaver",
        type: "polymer",
      });
      overkill = await actDrainCluster(api, posedOverkill);
    },

    async assert(api, check) {
      check.expectOk("the cluster's bond pool is broken through", exact.broke);
      check.expectEq(
        "chipping the pool pays nothing while it drains",
        exact.paidWhileDraining,
        0,
      );
      check.expectEq(
        "breaking the pool pays its whole value",
        exact.totalPaid,
        exact.maxBond,
      );

      check.expectOk("the larger pool is broken through", overkill.broke);
      // A Cleaver hits a bond pool for 4 (its damage of 2, doubled by the kinetic bond bonus).
      check.expectLt(
        "the breaking hit lands on less pool than the hit removes",
        overkill.bondBeforeBreak,
        4,
      );
      check.expectEq(
        "chipping the larger pool pays nothing while it drains",
        overkill.paidWhileDraining,
        0,
      );
      check.expectEq(
        "a breaking hit that overkills the pool still pays only the pool",
        overkill.totalPaid,
        overkill.maxBond,
      );
    },
  };
}
