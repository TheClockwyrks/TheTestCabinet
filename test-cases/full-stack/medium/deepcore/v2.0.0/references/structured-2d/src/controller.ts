// Deepcore — the player controller: the one seat input is read from.
//
// The game mode adds a single player, possessing the prospector, and this
// controller is that player's. Its tick is the ONE place the registered actions
// are read — the reader's edges are consume-on-read per controller, so a second
// reader would split a press — and the one place the engine's pointer and its
// ordered samples reach the game (specs/controls.md).
//
// Movement, thrust, and the drill are HELD, so they are read with `value` every
// frame and mirrored onto the state for the miner's own movement and drill to
// use. Everything else is an EDGE, read with `pressed` exactly once, here.
//
// The controller holds no authoritative state: everything it decides is written
// straight onto the world's `DeepcoreState`, through the transitions in
// `src/flow.ts` and the operations in `src/items.ts`. Controllers tick before any
// actor and before the game mode, so the movement the miner performs this frame
// is the movement this frame's keys asked for, and the mine drawn at the end of
// the frame is the one those keys produced.

import { PlayerController } from "@test-cabinet/structured-2d";
import type { ActionName } from "./constants";
import { controlAt, controlsFor, inside } from "./controls";
import type { Control } from "./controls";
import { dismissNotice } from "./feedback";
import {
  activate,
  activateNearbyBuilding,
  openPauseMenu,
  toggleInventory,
} from "./flow";
import { deepcoreState } from "./game";
import type { DeepcoreState, MoveInput } from "./game";
import { jettisonCoreSample, useItem } from "./items";
import { menuItems } from "./menus";
import { Prospector } from "./prospector";
import { itemForHotkey } from "./tuning";

/** The six supply hotkeys, in the order the number keys select them. */
const SUPPLY_ACTIONS = [
  "supply1",
  "supply2",
  "supply3",
  "supply4",
  "supply5",
  "supply6",
] as const;

export class DeepcoreController extends PlayerController {
  override tick(): void {
    const state = deepcoreState(this.world);
    // The controls are computed from the state as this frame opened on it,
    // which is the layout the previous frame drew and the one the pointer was
    // aimed at.
    const controls = controlsFor(state);
    this.readPointer(state, controls);
    this.readActions(state);
  }

  /**
   * Resolve this frame's pointer: the mirror the drawing hovers with, and every
   * press, in arrival order, against the controls the state offers.
   */
  private readPointer(
    state: DeepcoreState,
    controls: readonly Control[],
  ): void {
    const pointer = this.input.pointer();
    state.pointer = { x: pointer.x, y: pointer.y, down: pointer.down };
    for (const sample of this.input.pointerSamples()) {
      if (sample.type !== "down") continue;
      const hit = controlAt(controls, sample.x, sample.y);
      if (hit) this.run(state, hit.action);
    }
    this.syncMenuToPointer(state, controls, pointer.x, pointer.y);
  }

  /**
   * Move the highlight onto the menu item the pointer is over, so choosing with
   * the mouse and choosing with `activate` never disagree.
   */
  private syncMenuToPointer(
    state: DeepcoreState,
    controls: readonly Control[],
    x: number,
    y: number,
  ): void {
    if (state.screen === "in-mine") return;
    const items = menuItems(state);
    for (let i = 0; i < items.length; i += 1) {
      const control = controls.find((c) => c.action === items[i].action);
      if (control && inside(control, x, y)) {
        state.menuIndex = i;
        return;
      }
    }
  }

  /** Whether an action is held right now. */
  private held(action: ActionName): boolean {
    return this.input.value(action) > 0;
  }

  /**
   * Read this frame's actions: the held ones onto the state, and every edge
   * acted on once, in the order this screen gives them.
   */
  private readActions(state: DeepcoreState): void {
    // The held half of the frame goes to the pawn, which is what the miner's
    // own movement and cut read it from. A controller with no pawn — which is
    // only ever a frame between a death and a restart — writes it straight onto
    // the state instead, so the mirror is never a frame stale.
    const move: MoveInput = {
      left: this.held("left"),
      right: this.held("right"),
      down: this.held("down"),
      thrust: this.held("up"),
    };
    const pawn = this.pawn;
    if (pawn instanceof Prospector) pawn.drive(move);
    else state.input = move;

    // Every edge is read before any of them is acted on, so exactly one press is
    // spent per press whatever this screen does with it.
    const edges = {
      up: this.input.pressed("up"),
      down: this.input.pressed("down"),
      activate: this.input.pressed("activate"),
      inventory: this.input.pressed("inventory"),
      pause: this.input.pressed("pause"),
      mute: this.input.pressed("mute"),
      jettison: this.input.pressed("jettison"),
      supplies: SUPPLY_ACTIONS.map((action) => this.input.pressed(action)),
    };

    // Mute works on every screen, so it is acted on before the per-screen split.
    if (edges.mute) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    if (state.screen === "in-mine") {
      if (state.notice && edges.pause) {
        dismissNotice(state);
        return;
      }
      if (!state.panel) {
        for (let i = 0; i < edges.supplies.length; i += 1) {
          if (!edges.supplies[i]) continue;
          const id = itemForHotkey(i + 1);
          if (id) useItem(state, id);
          return;
        }
        if (edges.jettison) {
          jettisonCoreSample(state);
          return;
        }
      }
      if (edges.pause) openPauseMenu(state);
      else if (edges.activate) {
        if (!state.panel) activateNearbyBuilding(state);
      } else if (edges.inventory) toggleInventory(state);
      return;
    }

    // A menu screen: move the highlight, choose, or go back.
    const items = menuItems(state);
    if (items.length === 0) return;
    if (edges.up) {
      state.menuIndex = (state.menuIndex - 1 + items.length) % items.length;
    } else if (edges.down) {
      state.menuIndex = (state.menuIndex + 1) % items.length;
    } else if (edges.activate) {
      activate(state, items[state.menuIndex]?.action ?? "");
    } else if (edges.pause) {
      goBack(state);
    }
    clampMenuIndex(state);
  }

  /**
   * Run one control. Everything but the mute toggle is the game's own; muting is
   * the engine's, so it is the one control that reaches past the state.
   */
  private run(state: DeepcoreState, action: string): void {
    if (action === "sys:mute") {
      this.world.audio.setMuted(!this.world.audio.muted());
      return;
    }
    activate(state, action);
  }
}

/** Where `pause` leads from each screen that has a back. */
function goBack(state: DeepcoreState): void {
  if (state.screen === "mode-select" || state.screen === "how-to-play") {
    activate(state, "nav:title");
  } else if (state.screen === "size-select") activate(state, "nav:mode-select");
  else if (state.screen === "paused") activate(state, "resume");
  else if (state.screen === "victory" || state.screen === "game-over") {
    activate(state, "nav:title");
  }
}

/** Keep the highlight inside the menu the current screen shows. */
function clampMenuIndex(state: DeepcoreState): void {
  const items = menuItems(state);
  if (state.menuIndex >= items.length) {
    state.menuIndex = Math.max(0, items.length - 1);
  }
}
