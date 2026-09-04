// Shatter — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read —
// the reader's edges are consume-on-read per controller, so a second reader
// would split a press — and the one place the frame's input is resolved into
// the state (`specs/state.md`, The contract).
//
// Controllers tick before any actor and before the game mode, so the intent
// this frame's keys produced is the intent this frame's simulation runs on. A
// frame may be worth several ticks, which is why the intent is written onto the
// state rather than applied here: every tick of the frame flies the ship the
// same way.
//
// The two double-bound keys are settled by the SCREEN rather than by the
// binding: on `playing` this reads `pause` and the movement and fire holds, and
// on a screen showing a menu it reads `confirm` and `back`. `Space` therefore
// fires while the game is being played and confirms on a menu, and `Escape`
// raises `back` and `pause` together, which `paused` answers once by reading
// both before the menu's own edges (`specs/controls.md`).
//
// The mouse and the touch contacts are read here too, and applied AFTER the
// frame's key edges, because `specs/ui.md` reads them "once per frame, in the
// same input read as the keys". They drive the menus directly rather than
// through a registered action, so nothing of `ACTIONS` is raised by either.

import { PlayerController } from "@test-cabinet/structured-2d";
import { GAMEOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import { startGame, toTitle } from "./flow";
import { resolvePointer } from "./pointer";
import { shatterState, type ShatterState } from "./game";

/** The next index on a vertical menu, wrapping at both ends. */
function wrap(index: number, delta: number, count: number): number {
  return (((index + delta) % count) + count) % count;
}

export class ShatterController extends PlayerController {
  override tick(): void {
    const state = shatterState(this.world);

    // Mute works on every screen, so it is read before the per-screen switch.
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    // The screen as it stood when the frame began: a menu entry taken here
    // moves the game on, and the new screen's own reading starts next frame.
    switch (state.screen) {
      case "title":
        // A frame carrying a key confirm and a pointer confirm takes the key's
        // entry alone (`specs/ui.md`), so the samples go unread on that frame.
        if (this.menu(state, TITLE_ITEMS.length)) return;
        break;

      case "howto": {
        // Confirming leaves this screen as leaving it does, and neither touches
        // the title's highlight, so the return lands on the entry that opened it
        // (`specs/ui.md`).
        const leaving = this.input.pressed("back");
        const accepted = this.input.pressed("confirm");
        if (leaving || accepted) state.screen = "title";
        return;
      }
      case "playing":
        this.play(state);
        return;
      case "paused": {
        // Leaving this screen and pausing again each do what RESUME does
        // (`specs/ui.md`). Both edges are read before the menu's own, and a frame
        // carrying either resumes and does nothing else (`specs/controls.md`).
        const leaving = this.input.pressed("back");
        const pausing = this.input.pressed("pause");
        if (leaving || pausing) {
          this.resume(state);
          return;
        }
        if (this.menu(state, PAUSE_ITEMS.length)) return;
        break;
      }
      case "gameover":
        // Leaving this screen does what MENU does (`specs/ui.md`).
        if (this.input.pressed("back")) {
          toTitle(state);
          return;
        }
        if (this.menu(state, GAMEOVER_ITEMS.length)) return;
        break;
    }

    // The mouse and the contacts are applied AFTER the frame's key edges
    // (`specs/ui.md`), so a frame carrying a key move and a pointer selection
    // ends on the entry the pointer named.
    resolvePointer(state, this.input.pointerSamples(), (index) => {
      this.confirmEntry(state, index);
    });
  }

  /**
   * What confirming the entry at `index` does on the screen showing it.
   *
   * The one route a confirmed entry takes, whether a key edge raised it or a
   * mouse or a contact did (`specs/ui.md`: "The entry every confirm acts on is
   * the highlighted one, whichever input raised it").
   */
  private confirmEntry(state: ShatterState, index: number): void {
    switch (state.screen) {
      case "title":
        if (index === 0) startGame(state);
        // The highlight stays on `HOW TO PLAY` while the how-to screen shows
        // (`specs/ui.md`), so this moves the screen and nothing else.
        else state.screen = "howto";
        return;
      case "paused":
        if (index === 0) this.resume(state);
        else if (index === 1) startGame(state);
        else toTitle(state);
        return;
      case "gameover":
        if (index === 0) startGame(state);
        else toTitle(state);
        return;
      default:
        return;
    }
  }

  /** Live play: the pause key, and the holds the ship is flown by. */
  private play(state: ShatterState): void {
    if (this.input.pressed("pause")) {
      state.screen = "paused";
      state.menuIndex = 0;
      state.input.left = false;
      state.input.right = false;
      state.input.thrust = false;
      state.input.fire = false;
      return;
    }

    state.input.left = this.input.value("left") > 0;
    state.input.right = this.input.value("right") > 0;
    state.input.thrust = this.input.value("up") > 0;
    state.input.fire = this.input.value("a") > 0 || this.input.value("b") > 0;
  }

  /** Back to the field, exactly as it stood when it was paused. */
  private resume(state: ShatterState): void {
    state.screen = "playing";
    state.menuIndex = 0;
  }

  /**
   * A vertical menu's frame: `up` and `down` move the highlight and wrap at
   * both ends, and `confirm` accepts it. All three edges are read before any is
   * acted on, so exactly one press moves or accepts and nothing is left armed
   * for a later frame.
   *
   * Answers whether the frame's `confirm` edge was taken, which is what tells
   * the caller to leave this frame's pointer samples unread.
   */
  private menu(state: ShatterState, count: number): boolean {
    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const accepted = this.input.pressed("confirm");

    if (moveUp || moveDown) {
      state.menuIndex = wrap(state.menuIndex, moveUp ? -1 : 1, count);
      return false;
    }
    if (!accepted) return false;
    this.confirmEntry(state, state.menuIndex);
    return true;
  }
}
