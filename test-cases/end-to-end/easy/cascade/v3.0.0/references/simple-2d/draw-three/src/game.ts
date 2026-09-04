// Cascade — the state contract and the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once, before any frame, and returns the
// state and the surface together as `[state, debug]`. `update` and `render` then
// run once each per frame, `update` first, with the frame's delta time in
// SECONDS.
//
// THE STATE SHAPE BELOW IS THE CONTRACT `specs/state.md` fixes. Every declared
// field is here under its declared name, type and meaning; every one of them is
// `readonly` and every array a `readonly` array, so the declared type and the
// `DeepReadonly` view the engine hands out are the same shape. `initialize`
// builds the whole state in one go, so no field is optional and no frame can
// observe a half-built state. Nothing authoritative lives anywhere else: this
// build holds no module-level game state and closes over no mutable data, which
// is what makes the debug surface's `reset` enough to replay a scenario exactly.
//
// TWO FIELDS GO BEYOND THE DECLARATION, and `specs/state.md` allows exactly these
// two kinds:
//
//   * `trail` is the drawing resource the painted layer needs, which that file
//     names outright. It carries no decision the simulation makes; what the
//     cascade painted is reported by `trailStamps`, which is declared.
//   * `pendingCues` is the frame's outbox. A debug pose is a pure
//     `(state) => state` transition with no audio bus in reach, so a turn, a
//     deal or a move driven from code names the cue it raised here and the next
//     `update` plays it. It is empty at rest, drained by every frame, and
//     cleared by `reset`, so it holds nothing between frames that the declared
//     fields do not already say.
//
// HOW A FRAME IS BUILT. `update` copies the state it was handed into a working
// value, advances that, and returns it; the state it was handed is never written,
// and the compiler enforces it because the view is read-only. The working value
// is `Sim` in `src/sim.ts`, a field-for-field mutable mirror of the record below,
// so a rule reads as the sentence its spec writes rather than as a chain of
// spreads, and the result is assignable to `CascadeState` because the only
// difference between the two is the `readonly` markers.

import { MENU_BINDINGS, STAGE_H, STAGE_W } from "./constants";
import { defineCues } from "./audio";
import { createDebugApi, type CascadeDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { openingState } from "./flow";
import { renderGame } from "./render";
import { toSim } from "./sim";
import { stepFrame } from "./simulate";
import { COLOR } from "./theme";
import type { CueName } from "./constants";
import type { TrailLayer } from "./trail";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { applyMenuActions } from "./navigation";

// The surface's type belongs beside the state it poses, so it is exported from
// here whichever module implements it.
export type { CascadeDebugApi };
export type { CascadeSnapshot, SnapshotCard } from "./debug";

/**
 * The table background. `src/main.ts` hands it to the engine as the colour the
 * canvas is cleared to each frame, so the letterbox bars around the stage match
 * the felt itself.
 */
export const BACKGROUND: string = COLOR.felt;

// ---- The declared state (specs/state.md) ---------------------------------

export type Screen = "title" | "howto" | "playing" | "won";

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

export type PileKind = "stock" | "waste" | "foundation" | "tableau";

export interface CardState {
  readonly id: number;
  readonly suit: Suit;
  readonly rank: number;
  readonly faceUp: boolean;
}

export interface DragState {
  readonly cards: readonly CardState[];
  readonly fromPile: "waste" | "foundation" | "tableau";
  readonly fromIndex: number;
  readonly x: number;
  readonly y: number;
}

export interface DropTargetState {
  readonly pile: "foundation" | "tableau";
  readonly index: number;
}

export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
}

export interface PressState {
  readonly x: number;
  readonly y: number;
  readonly at: number;
}

export interface FlyerState {
  readonly id: number;
  readonly suit: Suit;
  readonly rank: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface CascadeState {
  readonly screen: Screen;
  /** The selected item on the menu the current screen shows. */
  readonly menuIndex: number;
  /** The title menu's remembered selection: the entry last activated there. */
  readonly titleIndex: number;

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
   * The persistent surface the cascade paints onto, built once by `initialize`
   * and never replaced. It is the drawing resource `specs/state.md` allows
   * beyond the declaration; `trailStamps` above is what the game and the debug
   * surface actually read.
   */
  readonly trail: TrailLayer;

  /**
   * The cues this frame's events raised, waiting for an `update` to play them.
   * Empty at rest.
   */
  readonly pendingCues: readonly CueName[];
}

// ---- The game ------------------------------------------------------------

/** The game the engine drives. */
export const game: Game<CascadeState, CascadeDebugApi> = {
  initialize(api: InitApi<CascadeState>): [CascadeState, CascadeDebugApi] {
    defineCues(api);
    registerDiagnostics(api);
    // The four menu actions specs/controls.md names, each bound to the codes it
    // fixes. The engine owns the keyboard, so the game registers names and reads
    // press edges back through `api.input.pressed`.
    for (const [name, keys] of Object.entries(MENU_BINDINGS)) {
      api.input.register(name, { keys: [...keys] });
    }
    return [openingState(), createDebugApi()];
  },

  update(
    state: DeepReadonly<CascadeState>,
    api: UpdateApi,
    dt: number,
  ): CascadeState {
    const sim = toSim(state);

    // Every sample the frame delivered, answered on its own and in the order it
    // arrived (specs/controls.md), then the clock and the cascade.
    stepFrame(sim, api.input.pointerSamples(), dt);

    // The frame's menu-action edges, in the order specs/controls.md fixes for a
    // frame carrying more than one.
    applyMenuActions(sim, api);

    // Muting is the engine's bit and the HUD's `SOUND` control is the game's
    // binding for it, so the toggle is reconciled here, where the audio bus is
    // in reach, and `muted` mirrors what the runtime ended up holding.
    if (sim.muted !== api.audio.muted()) api.audio.setMuted(sim.muted);
    sim.muted = api.audio.muted();

    // A frame that raised the same cue twice plays it once
    // (specs/audio.md), and the outbox is empty again by the time it returns.
    const cues = new Set(sim.pendingCues);
    sim.pendingCues = [];
    for (const cue of cues) api.audio.play(cue);

    return sim;
  },

  render(state: DeepReadonly<CascadeState>, api: RenderApi): void {
    renderGame(state, api.ctx, STAGE_W, STAGE_H);
  },
};
