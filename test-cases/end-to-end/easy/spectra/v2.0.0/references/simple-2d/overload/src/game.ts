// Spectra — the state contract and the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once, before any frame, and returns the
// state and the surface together as `[state, debug]`. `update` and `render` then
// run once each per frame, `update` first, with the frame's delta time in SECONDS.
//
// THE STATE SHAPE BELOW IS THE CONTRACT `specs/state.md` fixes. Every field is
// declared here under its declared name, type and meaning; every one of them is
// `readonly` and every array a `readonly` array, so the declared type and the
// `DeepReadonly` view the engine hands out are the same shape. `initialize` builds
// the whole state in one go, so no field is optional and no frame can observe a
// half-built state. There is no module-level game state in this build and no
// closure over mutable data, which is what makes the debug surface's `reset`
// enough to replay a scenario exactly.
//
// The one field beyond the declaration is `art`, the seeded sprites and the
// drone-burst system loaded once by `initialize`. It is not part of the game: it
// holds no decision the simulation makes, it is the same in every run, `reset`
// leaves it alone, and the snapshot does not report it. It lives in the state
// because `render` is handed the state and nothing else.
//
// HOW A FRAME IS BUILT. `update` copies the state it was handed into a working
// value, advances that, and returns it; the state it was handed is never written,
// and the compiler enforces that because the view is read-only. The working value
// is `Sim` in `src/sim.ts`, a field-for-field mutable mirror of the record below,
// so a rule reads as the arithmetic it is instead of as a chain of spreads.

import { STAGE_H, STAGE_W } from "./constants";
import { loadArt, type Art } from "./assets";
import { defineCues } from "./audio";
import { createDebugApi, type SpectraDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { openingState } from "./flow";
import { readInput, registerActions } from "./input";
import { renderGame } from "./render";
import { newFrameEvents, toSim } from "./sim";
import { stepFrame } from "./step";
import { COLOR } from "./theme";
import type { ParticleSimulator } from "@test-cabinet/particle-runtime";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The surface's type belongs beside the state it poses, so it is exported from
// here whichever module implements it.
export type { SpectraDebugApi };
export type { SpectraSnapshot } from "./debug";
export type { Art };
export { MODE } from "./overload";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the field itself.
 */
export const BACKGROUND: string = COLOR.background;

// ---- The declared state (specs/state.md) ---------------------------------

export type Screen =
  | "title"
  | "howto"
  | "stageIntro"
  | "inWave"
  | "paused"
  | "stageCleared"
  | "gameOver";

export type Phase = "live" | "ready";

export type Band = "cyan" | "magenta";

export type DroneKind = "shard" | "flux" | "prism";

export type DronePhase = "entering" | "formation" | "diving" | "returning";

export interface ShipState {
  readonly x: number;
  readonly band: Band;
  readonly lockout: number;
  readonly cooldown: number;
  readonly contact: boolean;
}

export interface DischargeState {
  readonly active: boolean;
  readonly radius: number;
}

export interface DroneState {
  readonly id: number;
  readonly kind: DroneKind;
  readonly x: number;
  readonly y: number;
  readonly band: Band;
  readonly phase: DronePhase;
  readonly phaseClock: number;
  readonly slotX: number;
  readonly slotY: number;
  readonly entryGroup: number;
  readonly bandClock: number;
  readonly shellAlive: boolean;
  readonly shotsFired: number;
  readonly travel: boolean;
  readonly oscillation: boolean;
  readonly fire: boolean;
  readonly charge: number;
}

export interface BulletState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly band: Band;
  readonly friendly: boolean;
}

export interface BurstState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly elapsed: number;
  readonly sim: ParticleSimulator;
}

export interface SpectraState {
  readonly screen: Screen;
  readonly phase: Phase;
  readonly phaseTimer: number;
  readonly menuIndex: number;

  readonly score: number;
  readonly lives: number;
  readonly stage: number;
  readonly extraLifeAwarded: boolean;
  readonly challengeHits: number;

  readonly resonance: number;
  readonly inversion: number;

  readonly ship: ShipState;
  readonly discharge: DischargeState;

  readonly drones: readonly DroneState[];
  readonly bullets: readonly BulletState[];
  readonly bursts: readonly BurstState[];

  readonly waveEntry: boolean;
  readonly diveLaunching: boolean;
  readonly entryClock: number;
  readonly swayClock: number;
  readonly diveClock: number;
  readonly diveTarget: number;

  readonly nextId: number;
  readonly simTime: number;
  readonly muted: boolean;
  readonly rngState: number;

  /**
   * The seeded art, loaded once by `initialize` and never changed after. It
   * carries no decision the simulation makes and `reset` leaves it exactly as it
   * is; a host that cannot decode an image draws the shapes the render falls back
   * to.
   */
  readonly art: Art;
}

// ---- The game ------------------------------------------------------------

/** The game the engine drives. */
export const game: Game<SpectraState, SpectraDebugApi> = {
  async initialize(
    api: InitApi<SpectraState>,
  ): Promise<[SpectraState, SpectraDebugApi]> {
    registerActions(api);
    defineCues(api);
    registerDiagnostics(api);

    // Awaited here, so every sprite and the burst system are plain values by the
    // time the first frame draws.
    const art = await loadArt(api.assets);

    return [openingState(art), createDebugApi()];
  },

  update(
    state: DeepReadonly<SpectraState>,
    api: UpdateApi,
    dt: number,
  ): SpectraState {
    const sim = toSim(state);

    // Muting is the engine's bit and the game's binding, so the toggle happens
    // here, where the audio bus is reachable, and `muted` mirrors the result.
    const input = readInput(api);
    if (input.mute) api.audio.setMuted(!api.audio.muted());

    // Cues are gathered rather than played as they happen, so a frame that raises
    // one twice still plays it once.
    const events = newFrameEvents();
    stepFrame(sim, input, dt, events);

    sim.muted = api.audio.muted();
    // While sound is muted the game starts no sound at all: it plays no cue
    // rather than playing one for the bus to silence.
    if (!sim.muted) for (const cue of events.cues) api.audio.play(cue);
    return sim;
  },

  render(state: DeepReadonly<SpectraState>, api: RenderApi): void {
    renderGame(state, api.ctx, STAGE_W, STAGE_H);
  },
};
