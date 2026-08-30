// Cascade — the game, as the runtime drives it.
//
// Three functions and one state value (`src/runtime.ts`). Everything they do
// lives in the modules beneath them: the piles and the rules in
// `src/board.ts`, the pointer in `src/controls.ts`, the victory cascade in
// `src/cascade.ts`, and the drawing in `src/render.ts`. This file is the order
// those things happen in, and nothing else.
//
// THE ORDER WITHIN AN UPDATE, and why it is this one:
//
//   1. The runtime's mute bit is mirrored into the state, so `snapshot().muted`
//      is a pure read of a declared field rather than a live call
//      (`specs/instrumentation.md`).
//   2. The frame's game time is added to `simTime`, whatever the screen, so the
//      double-click rule and every duration are measured against it.
//   3. Every pointer sample the frame delivered is answered on its own, in the
//      order it arrived, so a press and the release that followed it inside one
//      frame both take effect (`specs/controls.md`).
//   4. The victory cascade takes the frame.
//   5. Whatever the frame raised is played, once each (`specs/audio.md`).

import { defineCues } from "./audio";
import { updateCascade } from "./cascade";
import { resolvePointer } from "./controls";
import { registerDiagnostics } from "./diagnostics";
import { render } from "./render";
import type { Game, InitApi, RenderApi, UpdateApi } from "./runtime";
import { createState, type CascadeState } from "./state";
import { COLOR } from "./theme";

export type { CascadeState } from "./state";

/** The colour the whole canvas, letterbox bars included, is cleared to. */
export const BACKGROUND = COLOR.felt;

export const game: Game<CascadeState> = {
  initialize(api: InitApi): CascadeState {
    defineCues(api);
    const state = createState();
    registerDiagnostics(api, state);
    return state;
  },

  update(state: CascadeState, api: UpdateApi, dt: number): void {
    state.muted = api.audio.muted();
    state.simTime += dt;
    for (const sample of api.pointer.samples()) {
      resolvePointer(state, sample, api.audio);
    }
    updateCascade(state, dt);
    state.cues.flush(api.audio);
  },

  render(state: CascadeState, api: RenderApi): void {
    render(state, api.ctx);
  },
};
