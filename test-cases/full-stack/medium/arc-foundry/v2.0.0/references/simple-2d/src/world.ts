// Arc Foundry — the one place a read-only view of the state becomes a world again.
//
// The engine holds the game's state as a VALUE. It hands `update`, `render`, every
// diagnostic source, and every debug operation a `DeepReadonly` view of it, and stores
// whatever the transition returns as the next state. So nothing in this build ever
// holds a writable reference to the state a previous frame left behind, and the
// simulation — which is ordinary imperative code over a world it owns — needs a world
// of its own to advance.
//
// `thaw` is that seam, and it is the only one. It copies exactly the parts a step
// writes to, and carries the rest across as it stands:
//
// - The records a step edits are copied: each unit, each shot, each structure, and the
//   arrays holding them.
// - The records a step REPLACES rather than edits are carried by reference, because
//   every field of them is `readonly` and nothing can write through one: a composed
//   wave, a route, the ground path, the harvest, an armed roll, a queued effect.
// - The values that are not state at all are carried too: the loaded assets, and the
//   simulator behind a burst that is still playing.
//
// The result is a world the caller owns outright. Advancing it cannot be observed by
// anyone still holding the view it came from, which is what makes "a frame is a
// transition" true of a simulation written as one.

import type { FoundryWorld, Projectile, Structure, Unit } from "./types";
import type { DeepReadonly } from "ts-essentials";

/** The state as everything but a transition sees it. */
export type FoundryView = DeepReadonly<FoundryWorld>;

/** A world of one's own, from the view the engine handed over. */
export function thaw(state: FoundryView): FoundryWorld {
  return {
    screen: state.screen,
    phase: state.phase,
    paused: state.paused,
    menuIndex: state.menuIndex,
    mapId: state.mapId,
    difficultyId: state.difficultyId,
    charge: state.charge,
    integrity: state.integrity,
    maxIntegrity: state.maxIntegrity,
    mazeRating: state.mazeRating,
    finale: state.finale,
    wave: state.wave,
    speed: state.speed,
    units: state.units.map(thawUnit),
    projectiles: state.projectiles.map(thawProjectile),
    structures: state.structures.map(thawStructure),
    holding: state.holding,
    selectedId: state.selectedId,
    combineIds: [...state.combineIds],
    stampsUsed: state.stampsUsed,
    refinement: state.refinement,
    harvest: state.harvest,
    armedRoll: state.armedRoll,
    kills: state.kills,
    leakCount: state.leakCount,
    activeWave: state.activeWave,
    spawnerHeld: state.spawnerHeld,
    nextWave: state.nextWave,
    spawnCursor: state.spawnCursor,
    waveClock: state.waveClock,
    simTime: state.simTime,
    stepAcc: state.stepAcc,
    renderAlpha: state.renderAlpha,
    clockTime: state.clockTime,
    nextId: state.nextId,
    pressRng: state.pressRng,
    pressSeed: state.pressSeed,
    combatRng: state.combatRng,
    mazePath: state.mazePath,
    mazeLength: state.mazeLength,
    muted: state.muted,
    pointerX: state.pointerX,
    pointerY: state.pointerY,
    showCombos: state.showCombos,
    showDamage: state.showDamage,
    bursts: [...state.bursts],
    fxQueue: [...state.fxQueue],
    cueQueue: [...state.cueQueue],
    assets: state.assets,
  };
}

/** Its route is rebuilt rather than edited, so it travels as it is. */
function thawUnit(u: DeepReadonly<Unit>): Unit {
  return { ...u };
}

/** Its struck list grows as the shot resolves, so that one array is copied. */
function thawProjectile(p: DeepReadonly<Projectile>): Projectile {
  return { ...p, hitIds: [...p.hitIds] };
}

/**
 * A structure carries only plain fields, so a copy of the record is the whole of it.
 *
 * The three kinds are spread separately because a copy of a union has to keep the
 * discriminant that says which one it is.
 */
function thawStructure(s: DeepReadonly<Structure>): Structure {
  if (s.kind === "component") return { ...s };
  if (s.kind === "candidate") return { ...s };
  return { ...s };
}
