// Orrery — what the rules are handed: the live state, and the two calls they
// make outward.
//
// The editor (`src/editor.ts`), the run (`src/sim.ts`), the screen transitions
// (`src/flow.ts`), and the debug surface (`src/debug.ts`) are all written
// against this and nothing else, so a machine built by hand and one built from
// code run down exactly one path.
//
// Cues and effects are ASKED FOR rather than played. A rule that raises one
// queues it and the FRAME plays it, which is what lets a debug pose sound
// nothing at the call and still let the edit it committed sound on the next
// frame advanced (`specs/instrumentation.md`). The game mode owns the queues
// and drains them in its tick; nothing here knows about the engine.

import type { World } from "@clockwyrks/structured-2d";
import type { CueName } from "./constants";
import type { ParticleSystemName } from "./figures";
import type { StagePoint } from "./motion";
import type { OrreryState } from "./state";

/** One effect asked for: which produced system, and where on the stage. */
export interface EffectEvent {
  readonly system: ParticleSystemName;
  readonly at: StagePoint;
}

/**
 * One pointer sample as the editor reads it: a press, a move, or a release, at
 * a position in the stage's logical units.
 *
 * The engine delivers richer samples — the pointer id, the device, the buttons
 * — and `src/controller.ts` narrows each to this before it reaches a rule, so
 * a posed press through `specs/instrumentation.md`'s `pointerDown` and a
 * player's press are the same event to the game.
 */
export interface PointerSample {
  readonly type: "down" | "move" | "up";
  readonly x: number;
  readonly y: number;
}

/** The live game, and the two calls the rules make outward. */
export interface OrreryHost {
  /** The whole of the game's state: the world's `OrreryState`. */
  readonly state: OrreryState;
  /** Ask for a cue on this frame. Played once, however often it is asked. */
  cue(cue: CueName): void;
  /** Ask for one produced particle effect, at a position on the stage. */
  effect(system: ParticleSystemName, at: StagePoint): void;
  /** The engine's mute bit, which `state.muted` mirrors every frame. */
  muted(): boolean;
  /** Toggle the engine's mute bit, which the `mute` action does. */
  toggleMute(): void;
}

/**
 * Where each open world finds its host. A weak map rather than a field on the
 * world, so nothing outside `src/game.ts` needs to name the mode's class: the
 * player controller and the debug surface both reach the live game through the
 * world they already hold.
 */
const hosts = new WeakMap<World, OrreryHost>();

/** Point a world at the host its rules run through. The game mode does this once. */
export function bindHost(world: World, host: OrreryHost): void {
  hosts.set(world, host);
}

/** The open world's host, or the refusal that it is not running Orrery. */
export function hostOf(world: World): OrreryHost {
  const host = hosts.get(world);
  if (host === undefined) {
    throw new Error("Orrery: this world is not running Orrery's game mode");
  }
  return host;
}
