// Coil — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read — the
// reader's edges are consumed per controller, so a second reader would split a
// press — and each edge is routed through `src/flow.ts` onto the live state
// (specs/controls.md).
//
// The controller holds no authoritative state: everything it decides is written
// straight onto the world's `CoilState`. Controllers tick before the game mode
// does, so a press this frame is on the buffer before the frame's ticks resolve,
// exactly as a player expects: the key arrives, then the step it steers.
//
// `mute` is the one action that never reaches the state. It is the engine's bit,
// so the controller flips it on the world's bus and the mode's tick mirrors the
// result back for the HUD to read.

import { PlayerController } from "@test-cabinet/structured-2d";
import { startMusic } from "./audio";
import { handleAction, handlePointer } from "./flow";
import { coilState } from "./game";
import { pressedActions } from "./input";

export class CoilController extends PlayerController {
  override tick(): void {
    const state = coilState(this.world);
    for (const action of pressedActions(this.input)) {
      if (action === "mute") {
        this.world.audio.setMuted(!this.world.audio.muted());
      } else if (handleAction(state, action).roundBegan) {
        // The one thing routing does that the state cannot record: a round
        // BEGAN, which `specs/ui.md` sounds the music bed on.
        startMusic(this.world.audio);
      }
    }
    // After the frame's keyboard edges, as `specs/ui.md` states.
    for (const sample of this.input.pointerSamples()) {
      if (handlePointer(state, sample).roundBegan) {
        startMusic(this.world.audio);
      }
    }
  }
}
