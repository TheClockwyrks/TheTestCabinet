// Meltdown — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read —
// the reader's edges are consume-on-read per controller, so a second reader
// would split a press — and the one place the engine's ordered pointer samples
// reach the game, each resolved on its own through `src/pointer.ts`, in arrival
// order.
//
// Controllers tick before any actor does, so what a key or a tap decided here
// is what the mode advances and what the draw components render in the same
// frame. The cues the tick raised are played once each at the end of it, and
// the pointer mirror is refreshed last, so `state.pointer` reports the engine's
// own snapshot for the frame being drawn (specs/state.md).

import { PlayerController } from "@test-cabinet/structured-2d";
import {
  ACTIONS,
  TOWER_TYPES,
  type ActionName,
  type TowerType,
} from "./constants";
import { mergeCues, noCues, playCues, type CueFlags } from "./audio";
import {
  armType,
  rotatePreview,
  sellTowerById,
  upgradeTowerById,
} from "./build";
import { confirmMenu, leaveScreen, moveMenu, togglePause } from "./flow";
import { pointerDown, pointerMove, pointerUp } from "./pointer";
import { sendWave } from "./run";
import { meltdownState, type MeltdownState } from "./game";

/** The shop entry each `arm` action holds, in the shop order of `TOWER_TYPES`. */
const ARM_ACTIONS: readonly { action: ActionName; type: TowerType }[] =
  TOWER_TYPES.map((type, index) => ({
    action: `arm${index + 1}` as ActionName,
    type,
  }));

export class MeltdownController extends PlayerController {
  override tick(): void {
    const state = meltdownState(this.world);

    // Every action read exactly once, so no branch below can consume an edge a
    // sibling branch also needed.
    const pressed = {} as Record<ActionName, boolean>;
    for (const action of ACTIONS) pressed[action] = this.input.pressed(action);

    const cues = noCues();
    // Mute works on every screen and from two controls, so the toggles are
    // counted and answered once: two toggles in one frame leave the bit alone.
    let muteToggles = pressed.mute ? 1 : 0;

    if (state.screen === "playing") this.playing(state, pressed, cues);
    else this.menus(state, pressed, cues);

    for (const sample of this.input.pointerSamples()) {
      const result =
        sample.type === "down"
          ? pointerDown(state, sample.x, sample.y)
          : sample.type === "move"
            ? pointerMove(state, sample.x, sample.y)
            : pointerUp(state, sample.x, sample.y);
      mergeCues(cues, result.cues);
      if (result.mute) muteToggles += 1;
    }

    if (muteToggles % 2 === 1) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }
    playCues(this.world.audio, cues);

    // The engine's own snapshot, mirrored for the frame being drawn.
    state.pointer = this.input.pointer();
  }

  /**
   * The actions live play answers.
   *
   * `back` is answered first and alone, because its whole meaning is a
   * precedence rule over what is held and what is selected
   * (specs/controls.md, What `back` does): a frame that cancels a placement is
   * not also a frame that arms the next one.
   */
  private playing(
    state: MeltdownState,
    pressed: Record<ActionName, boolean>,
    cues: CueFlags,
  ): void {
    if (pressed.back) {
      this.back(state);
      return;
    }
    if (pressed.pause) {
      togglePause(state);
      return;
    }
    for (const entry of ARM_ACTIONS) {
      if (pressed[entry.action]) armType(state, entry.type);
    }
    if (pressed.rotate) rotatePreview(state);
    if (pressed.send) sendWave(state);
    if (pressed.speed) state.speed = state.speed === 1 ? 2 : 1;
    if (pressed.upgrade && state.selected !== null) {
      upgradeTowerById(state, state.selected);
    }
    if (pressed.sell && state.selected !== null) {
      if (sellTowerById(state, state.selected)) cues.sell = true;
    }
  }

  /**
   * The actions a menu screen answers.
   *
   * A move and a confirm arriving on ONE frame are two presses and both are
   * answered: the highlight moves and the row it landed on is taken. Every
   * action fires once per press, and no branch here swallows another's edge
   * (specs/controls.md, The actions).
   */
  private menus(
    state: MeltdownState,
    pressed: Record<ActionName, boolean>,
    cues: CueFlags,
  ): void {
    if (pressed.back) {
      this.back(state);
      return;
    }
    if (state.screen === "paused" && pressed.pause) {
      togglePause(state);
      return;
    }
    const previous = pressed.up || pressed.left;
    const following = pressed.down || pressed.right;
    if (previous && moveMenu(state, -1)) cues.menu = true;
    else if (following && moveMenu(state, 1)) cues.menu = true;
    if (pressed.confirm) confirmMenu(state);
  }

  /**
   * The `back` precedence rule, in the order `specs/controls.md` states it:
   * cancel a held placement, else deselect, else leave the screen — which from
   * live play is the pause screen.
   */
  private back(state: MeltdownState): void {
    if (state.build !== null) {
      armType(state, null);
      return;
    }
    if (state.selected !== null) {
      state.selected = null;
      return;
    }
    leaveScreen(state);
  }
}
