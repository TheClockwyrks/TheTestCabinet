// Orrery — the cues and effects a transition raised, waiting for a frame
// (specs/ui.md "Audio", specs/assets.md "The particle effects",
// specs/instrumentation.md).
//
// Cues are ASKED FOR, not played. A transition that raises one leaves it here,
// and the frame plays it — once per cue, however often it was asked for
// (specs/ui.md). That is what lets a pose of the debug surface sound nothing
// at the call and still let the edit it committed sound on the next frame
// advanced, and it is what keeps the simulation free of the audio bus: nothing
// under `src/sim.ts` has ever seen an `UpdateApi`. The produced particle
// effects travel the same way and for the same reason.
//
// This queue is deliberately NOT part of `OrreryState`. `specs/state.md` fixes
// that declaration and a pending cue is not one of its fields, and it is not a
// value the game carries either: a frame empties it completely, and a `reset`
// clears it, so nothing here survives an update or changes what the simulation
// decides. It is an outbox between a transition and the frame that follows it.
//
// Both queues are bounded. Nothing is obliged to drain them — a scenario may
// pose a hundred edits without advancing a frame — so the oldest entry is
// dropped rather than the queue being left to grow.

import type { Cue, ParticleSystemName } from "./figures";
import type { StagePoint } from "./motion";

/** One effect asked for: which produced system, and where on the stage. */
export interface EffectEvent {
  readonly system: ParticleSystemName;
  readonly at: StagePoint;
}

/** How many effects the queue holds before the oldest is dropped. */
const MAX_QUEUED_EFFECTS = 16;

/** The cues raised since the last frame played them. */
const cues = new Set<Cue>();

/** The effects raised since the last frame took them. */
let effects: EffectEvent[] = [];

/** Ask for a cue. Played once by the next frame, however often it is asked. */
export function raiseCue(cue: Cue): void {
  cues.add(cue);
}

/** Ask for one produced particle effect at a position on the stage. */
export function raiseEffect(system: ParticleSystemName, at: StagePoint): void {
  effects.push({ system, at: { x: at.x, y: at.y } });
  if (effects.length > MAX_QUEUED_EFFECTS) effects.shift();
}

/** The cues waiting, in the order they were first asked for. Non-destructive. */
export function pendingCues(): Cue[] {
  return [...cues];
}

/** Take the cues raised since the last call, emptying the queue. */
export function drainCues(): Cue[] {
  const taken = [...cues];
  cues.clear();
  return taken;
}

/** Take the effects raised since the last call, emptying the queue. */
export function drainEffects(): EffectEvent[] {
  const taken = effects;
  effects = [];
  return taken;
}

/** Empty both queues, which a reset and a fresh engine both do. */
export function clearOutbox(): void {
  cues.clear();
  effects = [];
}
