// Wick — the player controller: the one seat the actions are read from.
//
// The game mode adds a single player possessing the lamplighter, and this
// controller is that player's. Its tick is the one place the registered
// actions are read (specs/controls.md): the four movement actions as held
// values, mirrored onto the state for every tick the frame runs, and every
// action as a press edge, each routed through `src/flow.ts` against the
// screen that was up when the frame began, so a press that changes screens
// never also acts on the screen it lands in. `mute` is answered here on
// every screen, since the engine's bus owns muting.
//
// Controllers tick before the game mode does, so a press this frame is on the
// state before the frame's ticks resolve, exactly as a player expects: the
// key arrives, then the tick it steers. The controller holds nothing
// authoritative of its own.

import { PlayerController } from "@test-cabinet/structured-2d";
import { handleAction } from "./flow";
import { heldMovement, pressedActions } from "./input";
import { wickState } from "./state";

export class LamplighterController extends PlayerController {
  override tick(): void {
    const state = wickState(this.world);
    const audio = this.world.audio;
    state.held = heldMovement(this.input);

    const onScreen = state.screen;
    for (const action of pressedActions(this.input)) {
      if (action === "mute") {
        audio.setMuted(!audio.muted());
        continue;
      }
      handleAction(state, action, onScreen, (cue) => audio.play(cue));
    }
  }
}
