// Cascade — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the engine's pointer is read, and
// the one place the frame's samples reach the game.
//
// Every sample the frame delivered is answered on its own, in the order it
// arrived (specs/controls.md), so a press and the release that followed it
// inside one frame both take effect and a sweep that crossed several piles
// between two frames is not reduced to the position it ended at. Each sample
// goes through the same three resolvers the debug surface's pointer operations
// call, so a posed press and a player's press are the same event to the game.
//
// Controllers tick before any actor and before the game mode, so the table this
// frame's pointer moved is the table this frame's cascade advances and this
// frame's picture draws. The cues every sample of the tick raised are played
// once each at the end of it.

import { PlayerController } from "@test-cabinet/structured-2d";
import { applyAudio, mergeCues, noCues } from "./audio";
import { cascadeState } from "./game";
import { pointerDown, pointerMove, pointerUp } from "./input";

export class CascadeController extends PlayerController {
  override tick(): void {
    const state = cascadeState(this.world);
    const cues = noCues();

    for (const sample of this.input.pointerSamples()) {
      const one = noCues();
      switch (sample.type) {
        case "down":
          pointerDown(state, sample.x, sample.y, one);
          break;
        case "move":
          pointerMove(state, sample.x, sample.y, one);
          break;
        case "up":
          pointerUp(state, sample.x, sample.y, one);
          break;
      }
      mergeCues(cues, one);
    }

    applyAudio(this.world.audio, state, cues);
  }
}
