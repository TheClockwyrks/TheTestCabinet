// Kessler — the game: the state contract, the per-frame update, and the
// binding of the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the
// game hands to the engine. `initialize` runs once and returns the state and
// the surface together as `[state, debug]`: it registers every action in
// ACTIONS against its BINDINGS, declares the thirteen CUES and the two music
// beds over the produced files, loads the produced sprites and particle
// systems, registers the diagnostic sources, and builds the complete opening
// state. `update` and `render` then run once each per frame — `update` first,
// with the frame's delta time in SECONDS, then `render`.
//
// KESSLER RUNS ON A FIXED TICK. `update` reads this frame's press edges and
// routes each against the screen it arrived on, samples the two rotation
// holds, accumulates the frame's seconds, and resolves one tick for each
// whole `TICK_DT` the accumulator holds, carrying the remainder — all of it
// over one mutable working copy of the state (`src/flow.ts`), which is what
// the frame returns and the engine stores. The full simulation ticks on the
// `playing` screen alone, `waveclear` advances only its interstitial timer,
// and `render` advances nothing but the live particle overlays, which run on
// the frame delta the state carries (`specs/assets.md`).
//
// The state, the flow, the simulation, the surface, and the drawing each
// live in their own module; this file is where the engine meets them.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { loadSprites, loadSystems } from "./assets";
import { defineCues, syncBeds } from "./audio";
import { createDebugApi, type KesslerDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { SCREEN_ACTIONS } from "./figures";
import {
  bootState,
  cloneState,
  consumeTime,
  handleActionDraft,
  handlePointerDraft,
  type FlowIo,
  type KesslerState,
} from "./flow";
import { installSystems, spawnFx } from "./fx";
import {
  heldRotation,
  pointerMoves,
  pressedActions,
  registerActions,
} from "./input";
import { renderGame } from "./render";
import { COLORS } from "./theme";

// The state and the surface are part of the module contract and are exported
// from here whichever module implements them.
export type { KesslerState };
export type { KesslerDebugApi };

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the stage match the field.
 */
export const BACKGROUND: string = COLORS.stage;

/** The cue bus and the fx pool, as the flow's hooks. */
function frameIo(api: UpdateApi): FlowIo {
  return {
    cue: (cue) => api.audio.play(cue),
    particle: (system, x, y) => spawnFx(system, x, y),
  };
}

export const game: Game<KesslerState, KesslerDebugApi> = {
  /**
   * Runs once, before any frame. Neither the diagnostics nor the surface
   * holds the state: a source is handed the state current at the read, and
   * every operation on the surface takes the state it poses and returns the
   * next one (specs/instrumentation.md).
   */
  async initialize(
    api: InitApi<KesslerState>,
  ): Promise<[KesslerState, KesslerDebugApi]> {
    registerActions(api);
    registerDiagnostics(api);
    const [sprites, systems] = await Promise.all([
      loadSprites(api),
      loadSystems(api),
      defineCues(api),
    ]);
    installSystems(systems);
    return [bootState(sprites), createDebugApi()];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current
   * one.
   *
   * The press edges are read first and exactly once each — they are news for
   * one frame only — and each is routed against the screen the frame OPENED
   * on: `Space` carries both `confirm` and `launch`, and the two never answer
   * on the same screen (specs/controls.md), so the press that confirms START
   * must not also launch the ball on the play screen it just opened. Then the
   * frame's seconds are consumed into whole ticks, each tick playing its own
   * cues and raising its own particles, and the screen's music bed is
   * reconciled on the state the frame leaves behind. The pointer's samples
   * are routed between the two, in the order they arrived, because the menus
   * answer the pointer and touch as well as the keyboard
   * (`specs/controls.md`).
   */
  update(
    state: DeepReadonly<KesslerState>,
    api: UpdateApi,
    dt: number,
  ): KesslerState {
    const io = frameIo(api);
    const draft = cloneState(state);

    const arrivalScreen = state.screen;
    for (const action of pressedActions(api)) {
      if (!SCREEN_ACTIONS[arrivalScreen].includes(action)) continue;
      handleActionDraft(draft, action, io);
    }
    for (const move of pointerMoves(api)) handlePointerDraft(draft, move, io);

    consumeTime(draft, dt, heldRotation(api), io);
    draft.lastFrameDt = dt;

    syncBeds(api, draft.screen);
    return draft;
  },

  /**
   * Runs once per frame, after `update`, with the state `update` returned.
   * The context arrives cleared and already carrying the logical transform,
   * so everything draws in 1000x1000 coordinates; the read-only view is what
   * guarantees that rendering changes nothing.
   */
  render(state: DeepReadonly<KesslerState>, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
