// Cascade — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing — the table is played
// with the pointer rather than by driving a pawn — and this controller is that
// player's. Its tick is the ONE place the engine's ordered pointer samples reach
// the game, each resolved on its own through `src/pointer.ts`, in the order it
// arrived. A press and the release that followed it inside one frame therefore
// both take effect, and a gesture is never reduced to the last position of the
// frame that carried it (`specs/controls.md`).
//
// Controllers tick before any actor, so the table is drawn from the state this
// frame's input produced. The cues a tick's events raise are played once per kind
// at the end of the tick, and the HUD's `SOUND` control reaches the runtime's
// mute bit through the same batch.
//
// Cascade registers no actions, so nothing here reads one. The overlay's toggle
// key is engine chrome.

import { PlayerController } from "@test-cabinet/structured-2d";
import { applyEvents, noEvents } from "./audio";
import { cascadeState } from "./game";
import { pointerDown, pointerMove, pointerUp } from "./pointer";

export class CascadeController extends PlayerController {
  override tick(): void {
    const state = cascadeState(this.world);
    const events = noEvents();

    for (const sample of this.input.pointerSamples()) {
      if (sample.type === "down") {
        pointerDown(state, sample.x, sample.y, events);
      } else if (sample.type === "move") {
        pointerMove(state, sample.x, sample.y, events);
      } else {
        pointerUp(state, sample.x, sample.y, events);
      }
    }

    applyEvents(this.world.audio, events);
  }
}
