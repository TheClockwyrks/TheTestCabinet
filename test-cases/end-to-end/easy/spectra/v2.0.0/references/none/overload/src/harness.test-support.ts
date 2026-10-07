// Spectra — the driver this build's own tests run the game through.
//
// Not a test itself (`vitest.config.ts` collects `src/**/*.test.ts`), and not part
// of the game: it is the smallest thing that can drive the REAL game — the real
// `update`, the real input path, the real cue bus — with no browser and no canvas.
//
// It stands in for the runtime, so a test exercises exactly the code a played frame
// does: intent is read once per frame through the same `UpdateApi`, an edge is armed
// for one frame the way a keypress is, and the debug surface is handed a clock that
// runs whole frames. What it deliberately does NOT stand in for is drawing: no test
// here calls `render`, which is the point of the render-free core.

import { createDebugApi, type SpectraDebugApi } from "./debug";
import { createGame } from "./game";
import type { ActionName } from "./constants";
import type { Sprites } from "./assets";
import type { Game, InitApi, UpdateApi } from "./runtime";
import type { SpectraState } from "./types";
import type { CueSpec } from "./audio-bus";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";

import { IDLE_POINTER, type PointerFrame } from "./pointer";

/** What a driven run of the game exposes to a test. */
export interface Driver {
  /** The live state, exactly as the runtime would hold it. */
  readonly state: SpectraState;
  /** The debug and automation surface over that state. */
  readonly debug: SpectraDebugApi;
  /** Every cue played, in order, since the driver was built. */
  readonly played: string[];
  /** The diagnostic sources the game registered, by name. */
  readonly diagnostics: Map<string, () => unknown>;
  /** The actions the game registered, with the keys bound to each. */
  readonly bindings: Map<string, readonly string[]>;
  /** The cues the game declared, by name. */
  readonly cues: Map<string, CueSpec>;
  /** Run one frame worth `seconds` of game time. */
  frame(seconds: number): void;
  /** Run `frames` frames covering `seconds`, as `advance` does. */
  advance(seconds: number, frames?: number): void;
  /** Hold an action down, or let it up. */
  hold(action: ActionName, down: boolean): void;
  /** Arm one press edge, consumed by the next frame that reads it. */
  press(action: ActionName): void;
  /**
   * Stage the pointer report the next frame reads, in logical units.
   *
   * The runtime maps real pointer events into this shape once per frame
   * (`specs/ui.md`), and a frame spends it exactly as it spends a key edge.
   */
  pointer(frame: PointerFrame): void;
  /** Whether the bus is muted. */
  muted(): boolean;
  /** Forget every cue played so far. */
  clearPlayed(): void;
}

/** Sprite sources a test never draws through, with an optional burst system. */
export function stubSprites(burst: ParticleSystem | null = null): Sprites {
  const source = {} as CanvasImageSource;
  return {
    fighter: { cyan: source, magenta: source },
    shard: { cyan: source, magenta: source },
    fluxHeld: { cyan: source, magenta: source },
    fluxShimmer: source,
    prismShell: { cyan: source, magenta: source },
    prismCore: { cyan: source, magenta: source },
    burst,
  };
}

/** Stand the game up over a fake runtime and return the driver. */
export function driver(
  options: { burst?: ParticleSystem | null } = {},
): Driver {
  const held = new Set<string>();
  const edges = new Set<string>();
  const played: string[] = [];
  const diagnostics = new Map<string, () => unknown>();
  const bindings = new Map<string, readonly string[]>();
  const cues = new Map<string, CueSpec>();
  let muted = false;
  let pointerFrame: PointerFrame = IDLE_POINTER;

  const initApi: InitApi = {
    input: { register: (name, keys) => void bindings.set(name, keys) },
    audio: { define: (cue, spec) => void cues.set(cue, spec) },
    diagnostics: {
      register: (name, source) => void diagnostics.set(name, source),
    },
  };

  const updateApi: UpdateApi = {
    input: {
      value: (name) => (held.has(name) ? 1 : 0),
      pressed: (name) => {
        if (!edges.has(name)) return false;
        edges.delete(name);
        return true;
      },
    },
    pointer: {
      frame: () => pointerFrame,
      forget: () => {
        pointerFrame = { ...pointerFrame, released: null };
      },
    },
    audio: {
      play: (cue) => void played.push(cue),
      setMuted: (next) => void (muted = next),
      muted: () => muted,
    },
  };

  const game: Game<SpectraState> = createGame(
    stubSprites(options.burst ?? null),
  );
  const state = game.initialize(initApi);

  const frame = (seconds: number): void => {
    game.update(state, updateApi, seconds);
    // The runtime discards every edge nothing consumed at the end of a frame.
    edges.clear();
    pointerFrame = IDLE_POINTER;
  };

  const debug = createDebugApi(state, {
    setAutoStep: () => undefined,
    advance: (seconds, frames = 1) => {
      for (let index = 0; index < frames; index += 1) frame(seconds / frames);
    },
  });

  return {
    state,
    debug,
    played,
    diagnostics,
    bindings,
    cues,
    frame,
    advance: (seconds, frames = 1) => {
      for (let index = 0; index < frames; index += 1) frame(seconds / frames);
    },
    hold: (action, down) => {
      if (down) held.add(action);
      else held.delete(action);
    },
    press: (action) => void edges.add(action),
    pointer: (next) => void (pointerFrame = next),
    muted: () => muted,
    clearPlayed: () => void played.splice(0, played.length),
  };
}

/**
 * Open a quiet, empty live wave, exactly as a driven scenario does.
 *
 * The three world gates off, the field empty, the run at its opening figures: what
 * `specs/instrumentation.md`'s atomic operations compose into.
 */
export function startPosed(driven: Driver): void {
  const { debug } = driven;
  debug.reset();
  debug.clearDrones();
  debug.clearPlayerBullets();
  debug.clearEnemyBullets();
  debug.clearBursts();
  debug.setWaveEntry(false);
  debug.setDiveLaunching(false);
  debug.setShipContact(false);
  debug.setScreen("inWave");
  debug.setPhase("live");
  debug.setPhaseTimer(0);
  debug.setStage(1);
  debug.setShipX(640);
  debug.setShipBand("cyan");
  debug.setFireLockout(0);
  debug.setFireCooldown(0);
  debug.setResonance(0);
  debug.setInversion(0);
  debug.setDiveClock(0);
}

/** Pose one drone as a prop: placed, then every faculty turned off. */
export function poseDrone(
  driven: Driver,
  kind: "shard" | "flux" | "prism",
  x: number,
  y: number,
): number {
  driven.debug.addDrone(kind, x, y);
  const drones = driven.debug.snapshot().drones;
  const id = (drones[drones.length - 1] as { id: number }).id;
  driven.debug.setDroneTravel(id, false);
  driven.debug.setDroneOscillation(id, false);
  driven.debug.setDroneFire(id, false);
  return id;
}
