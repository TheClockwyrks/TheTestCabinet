// Wireworm — the state contract and the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the
// game hands to the engine. `initialize` runs once, before any frame, and
// returns the state and the surface together as `[state, debug]`. `update` and
// `render` then run once each per frame, `update` first, with the frame's delta
// time in SECONDS.
//
// THE STATE SHAPE BELOW IS THE CONTRACT `specs/state.md` fixes. Every field is
// declared here under its declared name, type and meaning; every one of them is
// `readonly` and every array a `readonly` array, so the declared type and the
// `DeepReadonly` view the engine hands out are the same shape. `initialize`
// builds the whole state in one go, so no field is optional and no frame can
// observe a half-built state. Nothing authoritative lives anywhere else: there
// is no module-level game state in this build and no closure over mutable data,
// which is what makes the debug surface's `reset` enough to replay a scenario
// exactly.
//
// The one field beyond the declaration is `sprites`, the seeded art loaded once
// by `initialize`. It is not part of the game: it holds no decision the
// simulation makes, it is the same in every run, `reset` leaves it alone, and
// the snapshot does not report it. It lives in the state because `render` is
// handed the state and nothing else, so there is nowhere else a frame could
// reach it from without a module-level variable, which this build does not have.
//
// HOW A FRAME IS BUILT. `update` copies the state it was handed into a working
// value, advances that, and returns it; the state it was handed is never
// written, and the compiler enforces that because the view is read-only. The
// working value is `Sim` in `src/sim.ts`, a field-for-field mutable mirror of
// the record below, so the advance reads as the arithmetic it is instead of as
// a chain of spreads, and the result is assignable to `WirewormState` because
// the only difference between the two is the `readonly` markers.

import { STAGE_H, STAGE_W } from "./constants";
import { defineCues } from "./audio";
import { loadSprites, type Sprites } from "./assets";
import { createDebugApi, type WirewormDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { openingState } from "./flow";
import { readInput, registerActions } from "./input";
import { renderGame } from "./render";
import { newFrameEvents, toSim } from "./sim";
import { stepFrame } from "./simulate";
import { COLOR } from "./theme";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The surface's type belongs beside the state it poses, so it is exported from
// here whichever module implements it.
export type { WirewormDebugApi };
export type { WirewormSnapshot } from "./debug";
export type { Sprites };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars around the stage match
 * the board itself.
 */
export const BACKGROUND: string = COLOR.background;

// ---- The declared state (specs/state.md) ---------------------------------

export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

export type Phase = "banner" | "active" | "respawn";

export type FoeKind = "glitch" | "dropper" | "corruptor";

export interface Tile {
  readonly c: number;
  readonly r: number;
}

export interface NodeState {
  readonly c: number;
  readonly r: number;
  readonly charge: number;
}

export interface WormState {
  readonly id: number;
  readonly segments: readonly Tile[];
  readonly dh: number;
  readonly dv: number;
  readonly diving: boolean;
  readonly stepping: boolean;
  readonly body: boolean;
  readonly stepClock: number;
}

export interface FoeState {
  readonly id: number;
  readonly kind: FoeKind;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly hit: boolean;
  readonly mind: boolean;
  readonly travel: boolean;
  readonly dartClock: number;
}

export interface BoltState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export interface ArcState {
  readonly from: Tile;
  readonly to: Tile;
  readonly life: number;
}

/**
 * Where one pointer's current press began.
 *
 * Bookkeeping for the rule `specs/ui.md` fixes: a confirm takes BOTH of its
 * edges inside one item's region, so the release has to know where the press
 * landed, and a press and its release may be frames apart. It is not part of the
 * declared state — nothing poses it, nothing reads it back, and it is rebuilt
 * from the pointer stream alone — and it lives here rather than in a
 * module-level variable because this build carries no state outside the value
 * the engine holds.
 */
export interface PressAnchor {
  /** The pointer the press came from, so several contacts are told apart. */
  readonly id: number;
  /** The screen the press landed on. */
  readonly screen: Screen;
  /** The menu item it landed in, or `-1` for a press outside every region. */
  readonly index: number;
}

export interface CursorState {
  readonly x: number;
  readonly y: number;
  readonly invulnerable: number;
  readonly contact: boolean;
}

export interface WirewormState {
  readonly screen: Screen;
  readonly phase: Phase;
  readonly phaseTimer: number;
  readonly menuIndex: number;

  readonly score: number;
  readonly lives: number;
  readonly level: number;
  readonly reachedLevel: number;

  readonly nodes: readonly NodeState[];
  readonly worms: readonly WormState[];
  readonly foes: readonly FoeState[];
  readonly bolts: readonly BoltState[];
  readonly arcs: readonly ArcState[];

  readonly cursor: CursorState;
  readonly fireCooldown: number;

  readonly foeSpawning: boolean;
  readonly wormEntry: boolean;
  readonly glitchTimer: number;
  readonly corruptorTimer: number;
  readonly dropperTimer: number;

  readonly nextId: number;
  readonly simTime: number;
  readonly muted: boolean;
  readonly rngState: number;

  /** The presses in flight. Derived bookkeeping; see {@link PressAnchor}. */
  readonly presses: readonly PressAnchor[];

  /**
   * The seeded sprite art, loaded once by `initialize` and never changed after.
   * It carries no decision the simulation makes and `reset` leaves it exactly as
   * it is; a frame that could not load a frame draws the shape it falls back to.
   */
  readonly sprites: Sprites;
}

// ---- The game ------------------------------------------------------------

/** The game the engine drives. */
export const game: Game<WirewormState, WirewormDebugApi> = {
  async initialize(
    api: InitApi<WirewormState>,
  ): Promise<[WirewormState, WirewormDebugApi]> {
    registerActions(api);
    defineCues(api);
    registerDiagnostics(api);

    // Awaited here, so every frame of the seeded art is a plain image value by
    // the time the first frame draws.
    const sprites = await loadSprites(api.assets);

    return [openingState(sprites), createDebugApi()];
  },

  update(
    state: DeepReadonly<WirewormState>,
    api: UpdateApi,
    dt: number,
  ): WirewormState {
    const sim = toSim(state);

    // Muting is the engine's bit and the game's binding, so the toggle happens
    // here, where the audio bus is reachable, and `muted` mirrors the result.
    const input = readInput(api);
    if (input.mute) api.audio.setMuted(!api.audio.muted());

    // Cues are gathered rather than played as they happen, so a frame that
    // raises one twice still plays it once.
    const events = newFrameEvents();
    stepFrame(sim, input, dt, events);

    sim.muted = api.audio.muted();
    for (const cue of events.cues) api.audio.play(cue);
    return sim;
  },

  render(state: DeepReadonly<WirewormState>, api: RenderApi): void {
    renderGame(state, api.ctx, STAGE_W, STAGE_H);
  },
};
