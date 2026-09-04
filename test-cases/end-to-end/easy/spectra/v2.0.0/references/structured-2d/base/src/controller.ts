// Spectra — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read — the
// reader's edges are consume-on-read per controller, so a second reader would
// split a press — and it resolves the whole frame's input into one `FrameInput`
// the mode's tick then advances the game under.
//
// WHY THE INPUT IS HANDED ON RATHER THAN APPLIED HERE. `specs/simulation.md`
// divides a frame into whole sub-steps and resolves contacts at the end of each,
// and `specs/ship.md` gates firing on clocks that count down inside that loop, so
// the frame's input has to be available INSIDE the sub-step loop the mode's tick
// runs. The value below is the frame's own, taken once and spent once: it is
// never carried from one frame to the next, so no game state lives here
// (`specs/state.md`).
//
// Muting is the exception, and it is applied here, because it is the runtime's
// bit rather than the game's: the engine owns it, the mode's tick copies the
// result onto `state.muted`, and the snapshot reports that copy.

import { PlayerController } from "@test-cabinet/structured-2d";
import { IDLE_INPUT, readInput, type FrameInput } from "./input";

export class SpectraController extends PlayerController {
  /**
   * The input this frame delivered, held between this controller's tick and the
   * mode's tick, which is the same frame. Derived from the engine's reader and
   * spent by `takeFrameInput`.
   */
  private frameInput: FrameInput = IDLE_INPUT;

  override tick(): void {
    const input = readInput(this.input);
    this.frameInput = input;

    // The runtime owns muting, and `mute` works on every screen.
    if (input.mute) this.world.audio.setMuted(!this.world.audio.muted());
  }

  /**
   * The frame's input, taken once. The held value returns to idle, so a frame in
   * which this controller did not tick — a paused world, whose ticks the engine
   * skips — advances the game under no input rather than under the last frame's
   * keys.
   */
  takeFrameInput(): FrameInput {
    const input = this.frameInput;
    this.frameInput = IDLE_INPUT;
    return input;
  }
}
