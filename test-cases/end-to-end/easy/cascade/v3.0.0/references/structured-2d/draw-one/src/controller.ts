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

import { PlayerController } from "@clockwyrks/structured-2d";
import { applyAudio, mergeCues, noCues } from "./audio";
import { cascadeState } from "./game";
import { pointerDown, pointerMove, pointerUp } from "./input";
import { applyMenuActions } from "./navigation";

export class CascadeController extends PlayerController {
  override tick(): void {
    const state = cascadeState(this.world);
    const cues = noCues();

    // The frame's menu-action edges, in the order specs/controls.md fixes for a
    // frame carrying more than one. Read before the pointer, so a frame that
    // carried both leaves the pointer's own gesture the last word on the table.
    const keyed = noCues();
    applyMenuActions(state, this.input, keyed);
    mergeCues(cues, keyed);

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
