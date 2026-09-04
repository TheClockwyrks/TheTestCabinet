// Orrery — the game the engine drives: the state contract, the debug surface,
// and the three functions a frame is (specs/state.md, specs/overview.md,
// specs/instrumentation.md).
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the
// game hands the engine. `initialize` runs once and returns the two together
// as `[state, debug]`: it registers every action in `ACTIONS` against its
// `BINDINGS`, declares the seven `CUES` over their produced files, decodes the
// produced sprites and particle systems, names the diagnostics the overlay
// shows, and builds the complete title-screen state. `update` and `render`
// then run once each per frame — `update` first, with the frame's delta time
// in SECONDS, then `render`.
//
// THE STATE IS HELD BY VALUE. `update` is handed the current state read-only
// and returns the next one, so a frame is a transition: clone the current
// state into a draft (`src/clone.ts`), stand a `Session` on the draft
// (`src/session.ts`), resolve the frame's pointer samples and press edges over
// it, advance the run by the frame's seconds, and hand the draft back. Nothing
// but that returned value and the debug surface's poses ever advances the
// game, and the read-only view is what makes it so.
//
// THE ORDER WITHIN A FRAME is input, then time, then sound, then drawing.
// Within the input, "a frame's keyboard edges are read first and the pointer
// and the touch contacts after them" (specs/ui.md "Pointer and touch"), so a
// frame carrying both leaves the highlight on the item the pointer named and
// takes the keyboard's item rather than the pointer's. Each press edge is
// routed against the action context AS IT STANDS AT THAT EDGE, so a press that
// changes the screen leaves the next press to the new one; each pointer sample
// is then resolved in the order it arrived, because specs/controls.md decides a
// lay by the positions the pointer passed through rather than by where it
// finished. The cues and effects those transitions raised are taken from the
// outbox afterwards and played once each, which is what `specs/ui.md` means by
// "played on the frame its event happens".

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { loadSprites, loadSystems } from "./assets";
import { defineCues, playCues, syncBed } from "./audio";
import { cloneState } from "./clone";
import { createDebugApi, type OrreryDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import {
  advanceEffects,
  clearEffects,
  fireEffects,
  installSystems,
} from "./effects";
import { SCREEN_ACTIONS } from "./figures";
import { installSprites, SpriteStore } from "./images";
import { pointerSamples, pressedActions, registerActions } from "./input";
import { clearOutbox, drainCues, drainEffects } from "./outbox";
import { render } from "./render";
import { Session, type SessionIo } from "./session";
import { createState } from "./state";
import { COLORS } from "./theme";
import type { OrreryState } from "./types";

// The state and the debug surface are part of this module's contract, and are
// exported from here whichever module declares them: `specs/state.md` fixes
// `OrreryState` and the types it is built from, and `specs/instrumentation.md`
// fixes `OrreryDebugApi`.
export type {
  Challenge,
  CyclePlan,
  DragState,
  EditorState,
  Fault,
  FaultKind,
  Focus,
  Grip,
  Hex,
  Instruction,
  Metrics,
  Mode,
  Molecule,
  MoteState,
  MoteType,
  OrreryState,
  PartKind,
  PartState,
  PatternFilament,
  PointerState,
  Pose,
  Screen,
  SimFilament,
  SimState,
  SimStatus,
  Solution,
  SolutionPart,
  TapeCell,
} from "./types";
export type { OrreryDebugApi };

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the stage carry the sky itself (specs/overview.md).
 */
export const BACKGROUND: string = COLORS.sky;

/** The one call a transition makes back into the engine's audio bus. */
function frameIo(api: UpdateApi): SessionIo {
  return {
    toggleMuted: () => api.audio.setMuted(!api.audio.muted()),
  };
}

export const game: Game<OrreryState, OrreryDebugApi> = {
  /**
   * Runs once, before any frame. Neither the diagnostics nor the surface holds
   * the state: a source is handed the state current at the read, and every
   * operation on the surface takes the state it poses and returns the next one
   * (specs/instrumentation.md).
   *
   * Every produced sprite is decoded and every cue is bound to its file before
   * this resolves, so no frame ever draws a half-loaded set. Each load is
   * guarded on its own, so a file that is missing or will not decode leaves
   * that sprite undrawn and that cue synthesized, and the game runs either way
   * (specs/assets.md).
   */
  async initialize(
    api: InitApi<OrreryState>,
  ): Promise<[OrreryState, OrreryDebugApi]> {
    registerActions(api);
    registerDiagnostics(api);
    // Nothing of a previous engine's is carried into this one: both queues are
    // presentation and audio, and neither is part of the state.
    clearOutbox();
    clearEffects();
    const [sprites, systems] = await Promise.all([
      loadSprites(api),
      loadSystems(api),
      defineCues(api),
    ]);
    installSprites(new SpriteStore(sprites));
    installSystems(systems);
    return [createState(), createDebugApi()];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * `simTime` accumulates `dt` whatever the screen, `muted` mirrors the
   * engine's bit, and the run advances only on the editor screen while its
   * status is `running` (specs/ui.md "What advances", specs/state.md).
   */
  update(
    state: DeepReadonly<OrreryState>,
    api: UpdateApi,
    dt: number,
  ): OrreryState {
    const session = new Session(cloneState(state), frameIo(api));

    // The keyboard edges are read first and the samples after them, and the
    // order alone does not settle the frame: a `confirm` that takes a menu
    // item changes the screen, and the samples read after it would land on
    // the menu the NEW screen shows and take a second item there. So the
    // frame carries the take forward and the samples that follow it only move
    // the highlight — "a frame carrying a keyboard `confirm` edge together
    // with a pointer or touch taking an item takes the keyboard's item alone"
    // (specs/ui.md "Pointer and touch").
    let took = false;
    for (const action of pressedActions(api)) {
      if (SCREEN_ACTIONS[session.actionContext()].includes(action)) {
        if (session.handleAction(action)) took = true;
      }
    }
    for (const sample of pointerSamples(api)) {
      session.handlePointer(sample, !took);
    }

    session.update(dt);
    session.state.muted = api.audio.muted();

    // The bed loops from the first frame, on every screen (specs/ui.md).
    syncBed(api);
    playCues(api, drainCues());
    // The effects a transition raised start now and advance on the frame's own
    // delta, so what `render` composites is this frame's picture of them.
    fireEffects(drainEffects());
    advanceEffects(dt);

    return session.state;
  },

  /**
   * Runs once per frame, after `update`, with the state `update` returned. The
   * context arrives cleared and already carrying the logical transform, so
   * everything draws in `STAGE_W x STAGE_H` units and a sprite drawn at its
   * native canvas size covers exactly the units `specs/assets.md` says it
   * does. The read-only view is what guarantees that rendering changes
   * nothing.
   */
  render(state: DeepReadonly<OrreryState>, api: RenderApi): void {
    render(api.ctx, state);
  },
};
