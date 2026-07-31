// Automated validation for the Hit Points sub-item `three-damage-types`.
//
// Shots carry one of three damage types on the projectile. The check builds each of the
// Emitter, Cleaver, and Reactor against a real target, runs on until each launches a real
// projectile, and reads its `damageType` — energy, kinetic, and nuclear respectively.
//
// THREE runs. Only the Emitter's is arranged; the Cleaver's and the Reactor's are posed
// inside `act` with `poseScenario`, since `api.reset` throws there. The old script opened a
// FOURTH run purely to film a reactor blast — `act` now ends on the Reactor, so that is
// what the clip shows anyway.

import {
  startScenario,
  poseScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  TICK,
  MAP,
} from "../_helpers.mjs";

/** Pose a tower of `kind` over a real target; `begin` opens the run. */
async function poseTower(api, begin, kind) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, kind, g, s0);
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 });
}

/** Run on until the posed tower launches a projectile, and read its damage type. */
async function actProjType(api) {
  // 180 ticks = the old 3 s cap. The old poll of 0.02 s is 1.2 ticks, which the contract
  // refuses; it meant "sample as finely as possible", and one TICK is the finest there is
  // — a projectile in flight can be gone again within a few ticks.
  const r = await api.until((s) => s.projectiles.length > 0, {
    max: 180,
    poll: TICK,
  });
  return r.hit ? r.snap.projectiles[0].damageType : null;
}

export default function item() {
  let emitter;
  let cleaver;
  let reactor;

  return {
    id: "hitpoints.three-damage-types",

    async arrange(api) {
      await poseTower(api, startScenario, "emitter");
    },

    // Each tower's first shot in turn.
    async act(api) {
      emitter = await actProjType(api);

      await poseTower(api, poseScenario, "cleaver");
      cleaver = await actProjType(api);

      await poseTower(api, poseScenario, "reactor");
      reactor = await actProjType(api);
    },

    async assert(api, check) {
      check.expectEq("the Emitter fires energy", emitter, "energy");
      check.expectEq("the Cleaver fires kinetic", cleaver, "kinetic");
      check.expectEq("the Reactor fires nuclear", reactor, "nuclear");
    },
  };
}
