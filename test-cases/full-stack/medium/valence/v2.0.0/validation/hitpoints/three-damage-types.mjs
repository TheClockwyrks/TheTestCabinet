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
  firstInRange,
  towerById,
  clipBudget,
  TICK,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

const MAX_SHOT_TICKS = 180; // 3 s — longer than the slowest reload here (the Reactor's 0.6/s)
// How long each tower is left working after its first shot. Three scenes that each ended on
// the frame a projectile appeared gave the reviewer three glimpses and, once the 8 s budget
// ran out partway through, usually only one or two of them at all. Held for two seconds
// apiece, each tower fires again and its shots are on screen long enough to read the colour
// the damage type is drawn in (specs/assets.md).
const SCENE_TICKS = MAX_SHOT_TICKS + TAIL_TICKS;

/** Pose a tower of `kind` over a real target; `begin` opens the run. */
async function poseTower(api, begin, kind) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const t = await placeCovering(api, kind, g, g.length * 0.18);
  // At the upstream edge of this tower's own range, so the target is still under it two
  // seconds later. Posed at the tower's covering point, a 6-electron atom is halfway out of
  // a Cleaver's short 88px radius before the scene is over.
  const s = firstInRange(g, towerById(await api.snapshot(), t.id));
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s });
}

/** Run on until the posed tower launches a projectile, and read its damage type. */
async function actProjType(api) {
  // The old poll of 0.02 s is 1.2 ticks, which the contract refuses; it meant "sample as
  // finely as possible", and one TICK is the finest there is — a projectile in flight can
  // be gone again within a few ticks.
  const r = await api.until((s) => s.projectiles.length > 0, {
    max: MAX_SHOT_TICKS,
    poll: TICK,
  });
  const type = r.hit ? r.snap.projectiles[0].damageType : null;
  // Keep filming this tower rather than cutting straight to the next scene.
  await api.advance(TAIL_TICKS);
  return type;
}

export default function item() {
  let emitter;
  let cleaver;
  let reactor;

  return {
    id: "hitpoints.three-damage-types",

    // Three framed scenes will not fit the runtime's default 8 s, and the one that gets cut
    // is always the Reactor — the slowest to fire and so the last to be reached.
    clipMs: clipBudget(3 * SCENE_TICKS),

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
