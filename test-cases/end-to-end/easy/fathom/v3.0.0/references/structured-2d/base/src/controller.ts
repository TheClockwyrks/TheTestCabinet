// Fathom — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read — the
// reader's edges are consume-on-read per controller, so a second reader would
// split a press — and each screen reads exactly the actions its own row of
// `specs/movement.md` names and leaves the rest alone, which is how `Space`
// drives the pulse in play and the menu everywhere else.
//
// The controller holds no authoritative state: everything it decides is written
// straight onto the world's `FathomState`, through the transitions in
// `src/flow.ts` and the abilities in `src/sim.ts`. Controllers tick before any
// actor does, so the trench's draw components render the state this frame's
// input produced, and the mode's tick advances the simulation from the desired
// direction settled here.

import { PlayerController } from "@clockwyrks/structured-2d";
import { noCues, playCues } from "./audio";
import { GAMEOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import { beginDive, openMenu, toTitle } from "./flow";
import type { Dir } from "./grid";
import { MOVE_ACTIONS } from "./input";
import { itemAt } from "./menu";
import { emitSonar, releaseInk } from "./sim";
import { fathomState, type FathomState } from "./game";

/** The next index on a vertical menu, wrapping at both ends. */
function wrap(index: number, delta: number, count: number): number {
  return (index + delta + count) % count;
}

/** What a press on a screen with no item regions is remembered as. */
const SCREEN_PRESS = 0;

export class FathomController extends PlayerController {
  override tick(): void {
    const state = fathomState(this.world);

    // The mute control is read on every screen, so it is read before the
    // per-screen switch (specs/ui.md).
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    switch (state.screen) {
      case "title":
        this.menu(state, TITLE_ITEMS.length, (index) => {
          // Confirming an entry here records it, from the keyboard, a pointer
          // and a contact alike, and every later arrival at the title lands on
          // it (`specs/ui.md`).
          state.titleIndex = index;
          if (index === 0) beginDive(state);
          else openMenu(state, "howto");
        });
        return;
      case "howto": {
        // Both the confirmation and the back control leave for the title, and
        // the screen shows no menu, so a gesture completed anywhere on it
        // returns too (`specs/ui.md`). All three are read before any is acted
        // on, so none is left armed for a later frame.
        const left = this.leaves();
        const tapped = this.screenGesture(state);
        if (left || tapped) toTitle(state);
        return;
      }
      case "paused":
        this.pauseMenu(state);
        return;
      case "gameover":
        if (this.input.pressed("back")) {
          toTitle(state);
          return;
        }
        this.menu(state, GAMEOVER_ITEMS.length, (index) => {
          if (index === 0) beginDive(state);
          else toTitle(state);
        });
        return;
      case "playing":
        this.play(state);
        return;
      default:
        // The countdown and the cleared interstitial read the mute control
        // alone, and it has already been read.
        return;
    }
  }

  /** Live play: the four movement actions held, the two abilities, the pause. */
  private play(state: FathomState): void {
    const pause = this.input.pressed("pause");
    const pulse = this.input.pressed("a");
    const ink = this.input.pressed("b");
    this.steer(state);

    if (pause) {
      openMenu(state, "paused");
      return;
    }

    const cues = noCues();
    if (pulse) emitSonar(state, cues);
    if (ink) releaseInk(state, cues);
    playCues(this.world.audio, cues);
  }

  /**
   * The desired direction the forager travels on. A movement action sets it and
   * it holds until another replaces it, so a newly pressed direction wins, a
   * direction whose key has been let go falls back to whatever is still held,
   * and nothing held at all brings the forager to rest (`specs/movement.md`).
   */
  private steer(state: FathomState): void {
    const held: Dir[] = [];
    for (const [action, dir] of MOVE_ACTIONS) {
      if (this.input.value(action) > 0) held.push(dir);
    }
    const fresh = held.filter((dir) => !state.heldDirs.includes(dir));
    if (fresh.length > 0) {
      state.desired = fresh[fresh.length - 1];
    } else if (state.desired === null || !held.includes(state.desired)) {
      state.desired = held[0] ?? null;
    }
    state.heldDirs = held;
  }

  /**
   * The pause menu, which the pause control leaves the same way `RESUME` does.
   *
   * `Escape` raises `back` and `pause` on the one frame, and the paused screen
   * reads both BEFORE the menu's own edges, so a frame carrying either resumes
   * once and does nothing else (`specs/ui.md`). Both are read so neither is left
   * armed for the frame after.
   */
  private pauseMenu(state: FathomState): void {
    const back = this.input.pressed("back");
    const paused = this.input.pressed("pause");
    if (back || paused) {
      openMenu(state, "playing");
      return;
    }
    this.menu(state, PAUSE_ITEMS.length, (index) => {
      if (index === 0) {
        openMenu(state, "playing");
      } else if (index === 1) {
        beginDive(state);
      } else {
        toTitle(state);
      }
    });
  }

  /** Reads and consumes both of the edges that leave a screen. */
  private leaves(): boolean {
    const accepted = this.input.pressed("confirm");
    const back = this.input.pressed("back");
    return accepted || back;
  }

  /**
   * A vertical menu's frame: `up` and `down` move the highlight and wrap at
   * both ends, and `confirm` takes the highlighted item. All three edges are
   * read before any is acted on, so exactly one press moves or accepts and
   * nothing is left armed for a later frame.
   */
  private menu(
    state: FathomState,
    count: number,
    onConfirm: (index: number) => void,
  ): void {
    // The pointer is read first, because a gesture selects the item it is over
    // before it confirms one and the confirm it raises acts on that selection.
    const pointed = this.menuPointer(state, count);
    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const accepted = this.input.pressed("confirm");
    if (pointed !== null) onConfirm(pointed);
    else if (moveUp) state.menuIndex = wrap(state.menuIndex, -1, count);
    else if (moveDown) state.menuIndex = wrap(state.menuIndex, 1, count);
    else if (accepted) onConfirm(state.menuIndex);
  }

  /**
   * The pointer and the finger over the current menu (`specs/ui.md`), and the
   * item a gesture confirmed, or `null` where none did.
   *
   * A sample that lands on an item selects it, which is what makes a mouse move
   * select and a contact select on its landing, since a finger never hovers. A
   * confirm requires both of its edges inside ONE item's region, so the release
   * confirms only where it lands on the item the press landed on: two edges in
   * different regions, and an edge outside every region, confirm nothing.
   */
  private menuPointer(state: FathomState, count: number): number | null {
    let confirmed: number | null = null;
    for (const sample of this.input.pointerSamples()) {
      const over = itemAt(state.screen, sample.x, sample.y);
      if (over !== null && over < count) state.menuIndex = over;
      if (sample.type === "down") {
        state.pressedItem = over;
        continue;
      }
      if (sample.type !== "up") continue;
      if (over !== null && over === state.pressedItem) confirmed = over;
      state.pressedItem = null;
    }
    return confirmed;
  }

  /**
   * A gesture completed on a screen that shows no menu: a pointer pressed and
   * released on it, or a contact landed and lifted on it (`specs/ui.md`).
   *
   * The screen carries no item regions, so the press is remembered as
   * `SCREEN_PRESS` rather than as an item, and the release completes the gesture
   * wherever on the screen it lands.
   */
  private screenGesture(state: FathomState): boolean {
    let tapped = false;
    for (const sample of this.input.pointerSamples()) {
      if (sample.type === "down") {
        state.pressedItem = SCREEN_PRESS;
        continue;
      }
      if (sample.type !== "up") continue;
      if (state.pressedItem === SCREEN_PRESS) tapped = true;
      state.pressedItem = null;
    }
    return tapped;
  }
}
