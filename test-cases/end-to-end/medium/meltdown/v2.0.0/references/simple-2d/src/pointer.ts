// Meltdown — the pointer, resolved once for both the player and a script.
//
// specs/controls.md fixes the model: one button, and a press and release inside
// one region is one interaction with that region. The interaction therefore
// resolves on the RELEASE, at the position the release landed on, and a press
// or a move only carries the preview and the shop hover.
//
// This module is the whole of that resolution. The engine's own pointer samples
// run through it inside `update`, and the debug surface's `pointerDown`,
// `pointerMove` and `pointerUp` run through the same three functions, so a
// posed press and a player's press are literally the same event
// (specs/instrumentation.md, The pointer).

import { FLOOR_X0, FLOOR_X1, FLOOR_Y0, FLOOR_Y1 } from "./constants";
import {
  armType,
  placeHeld,
  previewToPoint,
  rotateHeld,
  sellAt,
  towerAtTile,
  upgradeAt,
} from "./build";
import { confirmMenu, highlight, togglePause } from "./flow";
import { tileAt } from "./geometry";
import { controlsOf, hit, inPanel, menuRowAt } from "./panel";
import { send } from "./run";
import type { MeltdownState } from "./game";

/** What a pointer interaction raised, for the cues the frame plays. */
export interface PointerEvents {
  place: boolean;
  sell: boolean;
  menu: boolean;
}

/** A resolved pointer interaction. */
export interface PointerResult {
  readonly state: MeltdownState;
  readonly events: PointerEvents;
}

function quiet(state: MeltdownState): PointerResult {
  return { state, events: { place: false, sell: false, menu: false } };
}

/** Whether `(x, y)` is over the reactor floor rather than the casing or panel. */
function onFloor(x: number, y: number): boolean {
  return x >= FLOOR_X0 && x < FLOOR_X1 && y >= FLOOR_Y0 && y < FLOOR_Y1;
}

/** The shop entry `(x, y)` falls on, or `null`. */
function shopAt(state: MeltdownState, x: number, y: number) {
  return controlsOf(state).shop.find((entry) => hit(entry, x, y)) ?? null;
}

/** A press: it carries the preview and the hover, and resolves nothing. */
export function pointerDown(
  state: MeltdownState,
  x: number,
  y: number,
): PointerResult {
  const moved = carry({ ...state, pointer: { x, y, down: true } }, x, y);
  return quiet(moved);
}

/**
 * A move: the highlight follows the pointer onto a menu row, and the preview and
 * the shop hover follow it too.
 *
 * specs/controls.md: moving onto a row of the menu the current screen shows
 * makes that row the highlighted row and raises the `menu` cue on the frame the
 * highlight changes. Moving off every row leaves the highlight where it last
 * landed, and reaching the row already highlighted raises nothing — so the cue
 * is reported exactly when the index moved. Reaching a row takes it no further:
 * a row is taken on the release below.
 */
export function pointerMove(
  state: MeltdownState,
  x: number,
  y: number,
): PointerResult {
  const carried = carry(
    { ...state, pointer: { x, y, down: state.pointer.down } },
    x,
    y,
  );
  const row = menuRowAt(carried, x, y);
  const moved = row === null ? carried : highlight(carried, row);
  return {
    state: moved,
    events: {
      place: false,
      sell: false,
      menu: moved.menuIndex !== state.menuIndex,
    },
  };
}

/** The preview and the hover, which every press and move updates alike. */
function carry(state: MeltdownState, x: number, y: number): MeltdownState {
  const hovered = shopAt(state, x, y);
  const withHover: MeltdownState = {
    ...state,
    hoverShop: hovered ? hovered.type : null,
  };
  if (withHover.screen !== "playing" || withHover.build === null) {
    return withHover;
  }
  return previewToPoint(withHover, x, y);
}

/**
 * The release, which is where an interaction resolves: a menu row on a menu
 * screen, or a panel control, a placement, or a selection while playing.
 */
export function pointerUp(state: MeltdownState): PointerResult {
  const base: MeltdownState = {
    ...state,
    pointer: { ...state.pointer, down: false },
  };
  const { x, y } = base.pointer;

  if (base.screen === "playing") return playingRelease(base, x, y);

  const row = menuRowAt(base, x, y);
  if (row === null) return quiet(base);
  const moved = highlight(base, row);
  const events: PointerEvents = {
    place: false,
    sell: false,
    menu: moved.menuIndex !== base.menuIndex,
  };
  return { state: confirmMenu(moved), events };
}

/** A release while the game is being played. */
function playingRelease(
  state: MeltdownState,
  x: number,
  y: number,
): PointerResult {
  if (inPanel(x)) return panelRelease(state, x, y);
  if (!onFloor(x, y)) return quiet(state);

  if (state.build !== null) {
    const result = placeHeld(state);
    return {
      state: result.state,
      events: { place: result.placed, sell: false, menu: false },
    };
  }

  const tile = tileAt(x, y);
  const tower = towerAtTile(state, tile.col, tile.row);
  return quiet({ ...state, selected: tower ? tower.id : null });
}

/** A release on the build panel: whichever control it landed on. */
function panelRelease(
  state: MeltdownState,
  x: number,
  y: number,
): PointerResult {
  const controls = controlsOf(state);

  const entry = controls.shop.find((slot) => hit(slot, x, y));
  if (entry) return quiet(armType(state, entry.type));

  if (hit(controls.rotate, x, y)) return quiet(rotateHeld(state));
  if (hit(controls.cancel, x, y)) return quiet(armType(state, null));

  if (hit(controls.upgrade, x, y) && state.selected !== null) {
    return quiet(upgradeAt(state, state.selected).state);
  }
  if (hit(controls.sell, x, y) && state.selected !== null) {
    const result = sellAt(state, state.selected);
    return {
      state: result.state,
      events: { place: false, sell: result.sold, menu: false },
    };
  }

  if (hit(controls.send, x, y)) return quiet(send(state).state);
  if (hit(controls.speed, x, y)) {
    return quiet({ ...state, speed: state.speed === 1 ? 2 : 1 });
  }
  if (hit(controls.pause, x, y)) return quiet(togglePause(state));
  if (hit(controls.mute, x, y)) return quiet({ ...state, muted: !state.muted });
  return quiet(state);
}
