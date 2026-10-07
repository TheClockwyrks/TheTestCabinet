// Floe — the player controller: the one place an action is read.
//
// The engine owns the keyboard and resolves each registered action to a number;
// a game reads it through a player controller and through nothing else
// (engine/input.md). The game mode adds a single player possessing nothing
// (`specs/overview.md`), so this controller drives no pawn: it resolves the
// frame's actions into the game state, and the mode's tick — which runs after
// every controller — is what the simulation reads them from.
//
// EDGES ARE ACCUMULATED RATHER THAN CONSUMED HERE. The engine discards an edge
// the frame left unread, and a frame short enough to complete no whole
// simulation tick would otherwise lose the press inside it, so each edge is
// OR-ed into the state and the tick that consumes it clears it (`src/sim.ts`).

import { PlayerController } from "@clockwyrks/structured-2d";
import { floeState } from "./game";
import type { Facing } from "./game";

/** The four movement actions, in the order a held direction is resolved by. */
const HELD: readonly Facing[] = ["up", "down", "left", "right"];

export class FloeController extends PlayerController {
  override tick(): void {
    const intents = floeState(this.world).intents;

    intents.held = HELD.find((facing) => this.input.value(facing) > 0) ?? null;

    // Every edge is read, and so consumed, on every frame: an edge left armed
    // would be discarded when the input frame closes.
    intents.up = intents.up || this.input.pressed("up");
    intents.down = intents.down || this.input.pressed("down");
    intents.left = intents.left || this.input.pressed("left");
    intents.right = intents.right || this.input.pressed("right");
    intents.confirm = intents.confirm || this.input.pressed("confirm");
    intents.back = intents.back || this.input.pressed("back");
    intents.pause = intents.pause || this.input.pressed("pause");
    intents.mute = intents.mute || this.input.pressed("mute");

    // The pointer is the one input that reaches the game without a registered
    // action: `specs/controls.md` has a pointer and a touch contact drive the
    // menus directly. The engine has already mapped every sample into the game's
    // own logical units, so all this does is carry them across, in order, for the
    // tick to read (engine/input.md).
    for (const sample of this.input.pointerSamples()) {
      intents.pointer.push({
        kind: sample.type,
        x: sample.x,
        y: sample.y,
        touch: sample.device === "touch",
      });
    }
  }
}
