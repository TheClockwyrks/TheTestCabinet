// Orrery — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions and the
// pointer are read — the reader's edges are consumed per controller, so a
// second reader would split a press — and each is routed through `src/flow.ts`
// onto the live state (specs/controls.md).
//
// The POINTER SAMPLES ARE RESOLVED IN ORDER, every one of them, because
// specs/controls.md decides a lay by the positions the pointer passed through
// rather than by where it finished: a drag that crossed three hexes between two
// frames lays three cells of track. They are resolved BEFORE the action edges,
// so a press that begins a drag is live for the ghost verbs the same frame.
//
// Edges are routed against the screen that was up when each edge was resolved,
// through `SCREEN_ACTIONS`: an action a screen's row omits does nothing, so the
// `Enter` that opens a challenge from the select screen does not also answer
// the editor it opens (specs/controls.md "What each screen reads").
//
// The controller holds no authoritative state: everything it decides is written
// straight onto the world's `OrreryState`. Controllers tick before the game
// mode does, so a press this frame is on the state before the frame's cycles
// resolve, exactly as a player expects: the key arrives, then the time it
// steers.

import { PlayerController } from "@test-cabinet/structured-2d";
import { SCREEN_ACTIONS } from "./figures";
import { actionContext, handleAction, handlePointer } from "./flow";
import { pointerSamples, pressedActions } from "./input";
import { hostOf } from "./host";

export class OrreryController extends PlayerController {
  override tick(): void {
    const host = hostOf(this.world);
    for (const sample of pointerSamples(this.input)) {
      handlePointer(host, sample);
    }
    for (const action of pressedActions(this.input)) {
      // Each edge is routed against the screen as it stands at that edge, so a
      // press that changes the screen leaves the next press to the new one.
      if (SCREEN_ACTIONS[actionContext(host.state)].includes(action)) {
        handleAction(host, action);
      }
    }
  }
}
