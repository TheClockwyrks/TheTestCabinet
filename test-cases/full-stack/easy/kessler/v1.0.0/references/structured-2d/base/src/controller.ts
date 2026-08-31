// Kessler — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing the deflector, and this
// controller is that player's. Its tick is the ONE place the registered
// actions are read — the reader's edges are consumed per controller, so a
// second reader would split a press — and each edge is routed through
// `src/flow.ts` onto the live state (specs/controls.md). The two rotation
// actions are read as held values and mirrored onto the state, where the
// simulation's step 1 turns them into deflector motion on each tick.
//
// Edges are routed against the screen that was up when the frame began, so
// the `Space` that confirms START does not also launch on the play screen it
// opens: `Space` carries both `confirm` and `launch`, and the two never
// answer on the same screen (specs/controls.md).
//
// The controller holds no authoritative state: everything it decides is
// written straight onto the world's `KesslerState`. Controllers tick before
// the game mode does, so a press this frame is on the state before the
// frame's ticks resolve, exactly as a player expects: the key arrives, then
// the tick it steers.

import { PlayerController } from "@test-cabinet/structured-2d";
import { handleAction } from "./flow";
import { kesslerState } from "./state";
import { pressedActions } from "./input";

export class KesslerController extends PlayerController {
  override tick(): void {
    const state = kesslerState(this.world);
    state.held.left = this.input.value("left") > 0;
    state.held.right = this.input.value("right") > 0;

    const onScreen = state.screen;
    const hooks = {
      cue: (cue: string) => this.world.audio.play(cue),
      particle: () => undefined,
    };
    for (const action of pressedActions(this.input)) {
      handleAction(state, action, onScreen, hooks);
    }
  }
}
