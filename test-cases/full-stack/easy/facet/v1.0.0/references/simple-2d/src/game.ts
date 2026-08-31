// Facet — the game the engine drives: the state contract, the three functions,
// and the small amount of wiring that is neither the core's nor the renderer's.
//
// THE STATE SHAPE BELOW IS A CONTRACT (specs/state.md). It is written here
// exactly as that file fixes it: every field `readonly` and every array a
// `readonly` array, so the declared type and the `DeepReadonly` view the engine
// hands out are the same shape and a transition spreads a state into the next
// one without a cast. It is what the debug surface reads and poses, and what a
// caller driving this build from code reads back.
//
// THE RULES ARE THE CORE'S. `src/core/` is Facet's whole simulation — the
// board, R1 to R9, the chain cadence, the screens, and the pose logic behind the
// debug surface — written against nothing but the figures in
// `src/constants.ts`, with no engine, no renderer, and no DOM anywhere in it. It
// is the same directory in every reference build of this case, so a score
// recorded under one engine means what it means under another. This file does
// not restate a rule; `src/bridge.ts` maps the state declared below onto the
// core's own record and back, and `src/frame.ts` runs one frame through it.
//
// What is left here is what a `Game<S, D>` is: `initialize`, which declares the
// actions, the cues and the diagnostic sources, loads the produced files, and
// returns the opening state beside the debug surface; `update`, which is handed
// the current state and returns the next; and `render`, which draws that next
// state and changes nothing.

import { installCues } from "./audio";
import { fromCore, toCore } from "./bridge";
import { createInitialState, type FacetState as CoreState } from "./core";
import { createDebugApi, type FacetDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { Presentation } from "./effects";
import { runFrame } from "./frame";
import { registerActions } from "./input";
import { loadAssets, AssetStore } from "./assets";
import { renderGame } from "./render";
import { createScratchCanvas } from "./scratch";
import { COLOR } from "./theme";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The debug surface is part of this module's contract — `specs/instrumentation.md`
// fixes it and `initialize` returns it — so its type is exported from here
// whichever module implements it.
export type { FacetDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars around the stage match
 * the bench the board sits on.
 */
export const BACKGROUND: string = COLOR.bg;

// ---- The state contract (specs/state.md) ---------------------------------

export type GemKind =
  "ruby" | "amber" | "citrine" | "jade" | "beryl" | "sapphire" | "amethyst";

export type Cut = "plain" | "brilliant" | "star" | "prism";

export type Screen =
  "title" | "howto" | "playing" | "paused" | "levelclear" | "gameover";

export type Phase = "idle" | "swapping" | "resolving";

export type PointerDevice = "mouse" | "pen" | "touch";

export interface CellRef {
  readonly col: number;
  readonly row: number;
}

export interface GemState {
  readonly col: number;
  readonly row: number;
  readonly kind: GemKind | null;
  readonly cut: Cut;
  readonly strain: number;
  readonly fell: number;
}

export interface BoardState {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly GemState[];
}

export interface RefusalState {
  readonly a: CellRef;
  readonly b: CellRef;
  readonly timer: number;
}

export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
  readonly device: PointerDevice;
}

/**
 * The two cells one swap named, which is not a type `specs/state.md` declares
 * but is the shape the field under `FacetState`'s own heading below needs.
 */
export interface SwapRef {
  readonly a: CellRef;
  readonly b: CellRef;
}

export interface FacetState {
  readonly screen: Screen;
  readonly menuIndex: number;

  readonly board: BoardState;
  readonly phase: Phase;
  readonly chainStep: number;
  readonly swapTimer: number;
  readonly stepTimer: number;

  readonly score: number;
  readonly level: number;
  readonly levelScore: number;
  readonly lastCleared: number;
  readonly lastPoints: number;
  readonly lastWaves: number;

  readonly moveScore: number;
  readonly bestMove: number;
  readonly bestChain: number;

  readonly selection: CellRef | null;
  readonly offer: CellRef | null;
  readonly refusal: RefusalState | null;
  readonly armedTarget: string | null;

  readonly pointer: PointerState;
  readonly simTime: number;
  readonly muted: boolean;
  readonly rngState: number;

  // ---- Beyond the declaration ------------------------------------------
  //
  // One field the rules `specs/rules.md` fixes cannot be written without, and
  // which no declared field can be made to yield. It is authoritative rather
  // than derived, which is the one point at which this build's state goes past
  // `specs/state.md`'s "fields you add hold derived data"; the alternative is a
  // rule that cannot be implemented. `reset` restores it along with the
  // declared ones, and the snapshot does not report it, so nothing outside the
  // game can see it.

  /**
   * The swap the running chain began with, which R5 reads to seed a prism
   * chain and R8 reads to decide where a created gem is placed, and `null`
   * while `phase` is `idle`. R8 governs every step of a chain rather than only
   * the first, so the pair outlives the frame that made the swap. It is also
   * the pair the renderer draws in motion while `phase` is `swapping`.
   */
  readonly chainSwap: SwapRef | null;
}

// ---- What `initialize` loads, and what a frame reads ---------------------

// The produced sprites and particle systems, and the decorative sheets and
// bursts a chain throws. Neither is game state: `specs/state.md` allows exactly
// this — "loaded images and decoded audio ... `initialize` may hold them in a
// module-level table `render` reads" — and the presentation is the same kind of
// thing, a decoration derived from what each frame reported and never read back
// into the simulation. Both are replaced wholesale by `initialize`, so a second
// engine over this module starts from its own.
let assets = new AssetStore();
let presentation = new Presentation(createScratchCanvas);

/**
 * The state the previous frame left, in the core's own shape.
 *
 * The debug surface poses BETWEEN frames — `requestSwap`, and the three pointer
 * operations, each resolve a chain step the moment `engine.apply` runs them — so
 * a frame that only compared the state it was handed against itself would show
 * none of what a posed scenario did. Holding the last frame's state lets one
 * report cover the gap between two frames as well as the work inside one. It is
 * a decoration's bookkeeping, never read by a rule, and never the state the
 * engine holds.
 */
let seen: CoreState | null = null;

export const game: Game<FacetState, FacetDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * declare the cues over the produced sounds, register the diagnostic sources,
   * load the produced files, and return the complete opening state beside the
   * debug surface.
   *
   * Neither the diagnostics nor the surface holds the state: a source is handed
   * the state current at the read, and every operation on the surface takes the
   * state it poses and returns the next one (specs/instrumentation.md).
   *
   * The loads are awaited, so no frame is drawn before the stones are cut. A
   * file that does not arrive is not fatal: the store keeps what did, the
   * renderer falls back for what it is missing, and the game stays playable —
   * which is also what lets this build stand up in process, with no page to be
   * relative to.
   */
  async initialize(
    api: InitApi<FacetState>,
  ): Promise<[FacetState, FacetDebugApi]> {
    registerActions(api);
    registerDiagnostics(api);
    assets = await loadAssets(api);
    await installCues(api);
    presentation = new Presentation(createScratchCanvas);
    // The state the "last frame" left, standing in for a frame that has not run
    // yet. It is the opening state rather than nothing, because a pose can put a
    // board in play BEFORE the first frame: left empty, that frame would compare
    // the posed board against itself, see no change, and hand the presentation a
    // board it thinks was always there — so a round begun from code would arrive
    // with none of the motion a round begun from the menu arrives with.
    const opening = createInitialState();
    seen = opening;
    return [fromCore(opening), createDebugApi()];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * Everything the frame does is in `src/frame.ts`, over the core's own record;
   * this is the conversion at each end of it and the three mirrors
   * `specs/state.md` says the game keeps honest every frame — the pointer, the
   * engine's mute bit, and `simTime`, which the core's `tick` accumulates.
   */
  update(
    state: DeepReadonly<FacetState>,
    api: UpdateApi,
    dt: number,
  ): FacetState {
    const current = toCore(state);
    const outcome = runFrame(
      seen ?? current,
      current,
      api,
      dt,
      assets,
      presentation,
    );
    seen = outcome;
    const pointer = api.input.pointer();
    return {
      ...fromCore(outcome),
      pointer: {
        x: pointer.x,
        y: pointer.y,
        down: pointer.down,
        device: pointer.device,
      },
      muted: api.audio.muted(),
    };
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: DeepReadonly<FacetState>, api: RenderApi): void {
    renderGame(toCore(state), api.ctx, assets, presentation);
  },
};
