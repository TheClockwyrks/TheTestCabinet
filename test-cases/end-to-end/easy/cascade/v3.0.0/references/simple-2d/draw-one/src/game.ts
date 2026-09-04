// Cascade — the game: the state contract, the per-frame transition, and the
// binding of the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands the engine. `initialize` runs once and returns the state and the surface
// together, as `[state, debug]`. `update` and `render` then run once each per
// frame, `update` first with the frame's delta time in SECONDS, then `render`
// over the state it returned.
//
// The state is a VALUE and every frame is a transition over it: `update` is
// handed the current state as a `DeepReadonly` view and returns the next one, the
// engine stores what it returned, and `render` draws that. Nothing in this build
// writes into a state it was handed. Every rate in `src/constants.ts` is per
// second and is multiplied by `dt`, so there is no fixed timestep and no
// accumulator: the same second of game time reaches the same state whether it
// arrived as one long step or as sixty short ones, which is the property
// specs/instrumentation.md requires of the deterministic core.
//
// THE STATE SHAPE BELOW IS A CONTRACT (specs/state.md). Every field is declared
// here under its declared name, type, and meaning; `initialize` builds all of
// them in one go, so none is optional; and `reset()` on the debug surface
// restores exactly these. Nothing authoritative lives anywhere else: no module in
// this build holds game state and none closes over mutable data, so every module
// beside this one is arithmetic over the record below.

import { defineCues, playCues } from "./audio";
import { stepCascade } from "./cascade";
import type { CueName } from "./constants";
import { createDebugApi, type CascadeDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { openingState } from "./flow";
import { pointerDown, pointerMove, pointerUp } from "./pointer";
import { renderGame } from "./render";
import { COLOR } from "./theme";
import { createTrailLayer, type TrailLayer } from "./trail";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { CascadeDebugApi };

/**
 * The table's felt. `src/main.ts` hands it to the engine as the color the canvas
 * is cleared to each frame, so the letterbox bars match the table.
 */
export const BACKGROUND: string = COLOR.felt;

// ---- The state (specs/state.md) ------------------------------------------

/** The screen the game is on. */
export type Screen = "title" | "howto" | "playing" | "won";

/** The four suits of the deck. */
export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/** The four kinds of pile the table carries. */
export type PileKind = "stock" | "waste" | "foundation" | "tableau";

/** One card. Its color follows its suit and is read rather than held. */
export interface CardState {
  readonly id: number;
  readonly suit: Suit;
  readonly rank: number;
  readonly faceUp: boolean;
}

/** The run in hand: the grabbed card, the cards below it, and where it came from. */
export interface DragState {
  readonly cards: readonly CardState[];
  readonly fromPile: "waste" | "foundation" | "tableau";
  readonly fromIndex: number;
  readonly x: number;
  readonly y: number;
}

/** The pile a release would land the held run on. */
export interface DropTargetState {
  readonly pile: "foundation" | "tableau";
  readonly index: number;
}

/** The pointer's position in logical units, and whether it is held. */
export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
}

/** The most recent press, which the double-click rule is measured against. */
export interface PressState {
  readonly x: number;
  readonly y: number;
  readonly at: number;
}

/** One card in flight during the victory cascade. */
export interface FlyerState {
  readonly id: number;
  readonly suit: Suit;
  readonly rank: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** The whole of Cascade's state. */
export interface CascadeState {
  readonly screen: Screen;

  readonly stock: readonly CardState[];
  readonly waste: readonly CardState[];
  readonly wasteSets: readonly number[];
  readonly foundations: readonly (readonly CardState[])[];
  readonly tableau: readonly (readonly CardState[])[];

  readonly drag: DragState | null;
  readonly dropTarget: DropTargetState | null;
  readonly pointer: PointerState;
  readonly lastPress: PressState | null;

  readonly autoFlip: boolean;
  readonly winDetect: boolean;
  readonly launching: boolean;
  readonly trailPainting: boolean;

  readonly launchClock: number;
  readonly launched: number;
  readonly flyers: readonly FlyerState[];
  readonly cascadeDone: boolean;
  readonly trailStamps: number;

  readonly nextId: number;
  readonly simTime: number;
  readonly muted: boolean;
  readonly rngState: number;

  /**
   * The persistent surface the victory cascade paints on, which specs/state.md
   * allows beside the declared fields as the drawing resource the painted layer
   * needs. It is a handle rather than a value: the same one travels from state to
   * state, and a deal, `clearTrail`, and `reset` wipe it. It is `null` in a host
   * that offers no drawing surface at all, where the game still runs and
   * `trailStamps` still counts what the cascade painted.
   */
  readonly trail: TrailLayer | null;
}

// ---- The frame -----------------------------------------------------------

/**
 * Every pointer sample the frame delivered, answered in the order it arrived
 * (specs/controls.md).
 *
 * A gesture is never reduced to the last position of the frame that carried it,
 * so a press and the release that followed it inside one frame both take effect.
 */
function handlePointer(
  state: CascadeState,
  api: UpdateApi,
): { state: CascadeState; cues: readonly CueName[] } {
  let next = state;
  const cues: CueName[] = [];
  for (const sample of api.input.pointerSamples()) {
    const outcome =
      sample.type === "down"
        ? pointerDown(next, sample.x, sample.y)
        : sample.type === "move"
          ? pointerMove(next, sample.x, sample.y)
          : pointerUp(next, sample.x, sample.y);
    next = outcome.state;
    cues.push(...outcome.cues);
  }
  return { state: next, cues };
}

// ---- The game the engine drives ------------------------------------------

export const game: Game<CascadeState, CascadeDebugApi> = {
  /**
   * Runs once, before any frame: define the ten cues, register the diagnostic
   * sources, build the painted layer, and build the complete opening state.
   *
   * Neither the diagnostics nor the surface holds the state: a source is handed
   * the state current at the read, and every operation on the surface takes the
   * state it poses and returns the next one. The surface is returned beside the
   * state because the pair is what the engine holds, so by the time this resolves
   * `engine.debug` carries it (specs/instrumentation.md).
   */
  initialize(api: InitApi<CascadeState>): [CascadeState, CascadeDebugApi] {
    defineCues(api);
    registerDiagnostics(api);
    return [
      openingState(undefined, false, createTrailLayer()),
      createDebugApi(),
    ];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * The frame's pointer samples are answered first, in arrival order, then the
   * clock moves and the victory cascade takes its step. Cues are played last,
   * once each however many times the frame raised them, so what a frame sounds is
   * decided by the same function that advanced the simulation.
   *
   * The engine owns the audio bus. The HUD's `SOUND` control flips the game's own
   * copy of the mute bit, which is pushed to the bus here and then read back, so
   * `snapshot().muted` reports the bit the runtime actually holds.
   */
  update(
    state: DeepReadonly<CascadeState>,
    api: UpdateApi,
    dt: number,
  ): CascadeState {
    const handled = handlePointer(state, api);
    const ticked: CascadeState = {
      ...handled.state,
      simTime: handled.state.simTime + dt,
    };
    const cascaded = stepCascade(ticked, dt);

    if (cascaded.state.muted !== api.audio.muted()) {
      api.audio.setMuted(cascaded.state.muted);
    }
    playCues(api, [...handled.cues, ...cascaded.cues]);

    return { ...cascaded.state, muted: api.audio.muted() };
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: DeepReadonly<CascadeState>, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
