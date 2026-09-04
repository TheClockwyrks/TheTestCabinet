// Cascade — the game, as the runtime drives it.
//
// The whole of the contract with `src/runtime.ts` is here and is deliberately
// thin: `initialize` declares the cues and the diagnostics and builds the one
// state value, `update` advances that value by a delta in seconds, `render` draws
// it, and `pointer` answers one sample the moment it arrives. Everything else
// lives in the modules this file wires together.
//
// THE SIMULATION READS NOTHING FROM THE RENDERER (specs/instrumentation.md).
// `update` never touches the canvas and `render` never writes to the state, so an
// interval of game time reaches the same place however it was divided into frames
// and whether or not anything was ever drawn.

import { defineCues, flushCues } from "./audio";
import { stepCascade } from "./cascade";
import { registerDiagnostics } from "./diagnostics";
import { handlePointer } from "./input";
import { render as draw } from "./render";
import type { Game } from "./runtime";
import { createState, type CascadeState } from "./state";

export type { CascadeState } from "./state";

/** The game this build hands the runtime. */
export const game: Game<CascadeState> = {
  initialize(api) {
    defineCues((cue, spec) => api.audio.define(cue, spec));
    const state = createState();
    registerDiagnostics(api, state);
    return state;
  },

  update(state, api, dt) {
    // The game's own copy of the runtime's mute bit, refreshed every update, so
    // the snapshot reports the bit the runtime holds without reading it at the
    // moment of the read (specs/instrumentation.md).
    state.muted = api.audio.muted();
    state.simTime += dt;
    stepCascade(state, dt);
    // Each cue this frame raised, played once, in the fixed order
    // (specs/audio.md).
    flushCues(state, api.audio);
  },

  render(state, api) {
    draw(state, api.ctx);
  },

  pointer(state, api, sample) {
    handlePointer(state, api.audio, sample);
  },
};
