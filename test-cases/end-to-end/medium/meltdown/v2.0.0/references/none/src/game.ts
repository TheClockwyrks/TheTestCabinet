// Meltdown — the game the runtime drives.
//
// Four functions and one state (`src/runtime.ts`):
//
//   * `initialize` declares the bindings, the cues and the overlay's sources,
//     and builds the whole state in one go.
//   * `update` mirrors what the runtime owns into the state, takes the frame's
//     action edges, and advances the simulation by the frame's game time.
//   * `render` draws what the update left.
//   * `pointer` resolves one pointer event the moment it arrives.
//
// WHERE A CUE COMES FROM. A cue belongs to the frame that resolved its event and
// is played from the frame loop (specs/audio.md). A pointer event resolves the
// moment it arrives, which may be between two frames, so a cue it raises is
// QUEUED and played by the next frame rather than sounding outside the loop. An
// event reported through the debug surface raises none at all, because an
// operation of that surface resolves outside the loop entirely
// (specs/instrumentation.md).

import { ACTIONS, BINDINGS } from "./constants";
import { CUE_SPECS } from "./audio";
import { registerDiagnostics } from "./diagnostics";
import { applyPointerSample, performAction, type InputHost } from "./input";
import { renderGame } from "./render";
import type { PointerSample } from "./pointer";
import type { Game, InitApi, RenderApi, UpdateApi } from "./runtime";
import { stepSimulation } from "./sim";
import { createState, type MeltdownState } from "./state";
import { NO_CUES } from "./build";

/** Whether the simulation advances on this screen. */
function simulates(screen: MeltdownState["screen"]): boolean {
  return screen !== "paused" && screen !== "victory" && screen !== "gameover";
}

/** Whether the game's own clock advances on this screen. */
function keepsTime(screen: MeltdownState["screen"]): boolean {
  return screen !== "paused";
}

/** Build the game. The queue of cues waiting for a frame lives in the closure. */
export function createGame(): Game<MeltdownState> {
  const pending: string[] = [];

  /** A sink that plays now if a frame is running, and queues one if not. */
  function sinkFor(api: UpdateApi, inFrame: boolean): InputHost {
    return {
      cue: (cue) => {
        if (inFrame) api.audio.play(cue);
        else pending.push(cue);
      },
      setMuted: (muted) => api.audio.setMuted(muted),
      muted: () => api.audio.muted(),
    };
  }

  return {
    initialize(api: InitApi<MeltdownState>): MeltdownState {
      for (const action of ACTIONS)
        api.input.register(action, BINDINGS[action]);
      for (const [cue, spec] of CUE_SPECS) api.audio.define(cue, spec);
      registerDiagnostics(api);
      return createState();
    },

    update(state: MeltdownState, api: UpdateApi, dt: number): void {
      // Cues raised between frames, played from the frame loop after all.
      if (pending.length > 0) {
        for (const cue of pending.splice(0)) api.audio.play(cue);
      }

      // The two fields the game keeps honest every frame: the pointer's own
      // position, and the runtime's mute bit (specs/instrumentation.md).
      const pointer = api.input.pointer();
      state.pointer.x = pointer.x;
      state.pointer.y = pointer.y;
      state.pointer.down = pointer.down;
      state.muted = api.audio.muted();

      const host = sinkFor(api, true);
      for (const action of ACTIONS) {
        if (api.input.pressed(action)) performAction(state, action, host);
      }

      const gameDt = dt * state.speed;
      if (keepsTime(state.screen)) state.simTime += gameDt;
      if (simulates(state.screen)) stepSimulation(state, gameDt, host.cue);

      state.muted = api.audio.muted();
    },

    render(state: MeltdownState, api: RenderApi): void {
      renderGame(state, api.ctx);
    },

    pointer(state: MeltdownState, sample: PointerSample, api: UpdateApi): void {
      const host = sample.silent
        ? { ...sinkFor(api, false), cue: NO_CUES }
        : sinkFor(api, false);
      applyPointerSample(state, sample, host);
    },
  };
}

/** The one game this build ships. */
export const game: Game<MeltdownState> = createGame();

export type { MeltdownState };
