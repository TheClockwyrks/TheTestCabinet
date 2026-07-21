// Automated validation for the Upgrades sub-item `branch-a-vs-b`.
//
// A tower's two tier-III branches behave distinctly. The check compares the Emitter's
// two branches by how many shots a single volley launches at three in-range targets: the
// Spread branch (B) fires at up to three at once, while the Charged branch (A) fires a
// single bolt.
//
// TWO runs: the Spread branch is arranged, the Charged branch posed inside `act` with
// `poseRun` (control ops only — `api.reset` throws there).

import {
  startRun,
  poseRun,
  pathGeom,
  placeCovering,
  spawnAt,
  TICK,
  MAP,
} from "../_helpers.mjs";

/** Pose a tier-III Emitter of `branch` over three in-range atoms; `begin` opens the run. */
async function poseVolley(api, begin, branch) {
  const snap = await begin(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.2;
  const t = await placeCovering(api, "emitter", g, s0);
  await api.call("upgradeTower", t.id); // -> tier II
  await api.call("upgradeTower", t.id, branch); // -> tier III
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 - 45 });
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 });
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 + 45 });
}

/** Run on to the first volley and count the shots it put in the air. */
async function actVolleyCount(api) {
  // 120 ticks = the old 2 s cap. The old poll of 0.02 s is 1.2 ticks, which the contract
  // refuses; it meant "sample as finely as possible", and the count must be read on the
  // tick the volley launches — a tick later and the shots have begun to land.
  const r = await api.until((s) => s.projectiles.length > 0, {
    max: 120,
    poll: TICK,
  });
  return r.snap.projectiles.length;
}

export default function item() {
  let spread;
  let charged;

  return {
    id: "upgrades.branch-a-vs-b",

    async arrange(api) {
      await poseVolley(api, startRun, "B"); // SPREAD: up to 3 targets
    },

    // Both volleys, back to back — the Spread branch fanning out, then the Charged branch
    // firing its single bolt at the same three atoms.
    async act(api) {
      spread = await actVolleyCount(api);

      await poseVolley(api, poseRun, "A"); // CHARGED: a single bolt
      charged = await actVolleyCount(api);
    },

    async assert(api, check) {
      check.expectGt(
        "the Spread branch fires at more targets per volley than Charged",
        spread,
        charged,
      );
      check.expectGe("Spread launches multiple shots at once", spread, 2);
      check.expectEq("Charged launches a single shot", charged, 1);
    },
  };
}
