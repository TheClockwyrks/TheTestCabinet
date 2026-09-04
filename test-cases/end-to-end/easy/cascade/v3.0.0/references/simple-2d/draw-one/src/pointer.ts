// Cascade — the pointer (specs/controls.md).
//
// One press, one move, and one release, each resolved on its own the moment it
// arrives. `update` folds the frame's samples through these in the order they
// arrived, and the debug surface calls exactly the same three, so a posed press
// and a player's press are the same event to the game.

import {
  CUES,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  STOCK_X,
  TOP_ROW_Y,
} from "./constants";
import {
  cardAtPoint,
  cardCenter,
  cardRect,
  cardTopLeft,
  menuControl,
  menuItemAt,
  pileAtPoint,
  pointIn,
  wrapMenuIndex,
  type ControlId,
} from "./layout";
import {
  accepts,
  autoMove,
  detachRun,
  landRun,
  liftableRun,
  newGame,
  playableCard,
  turnStock,
  unchanged,
  type Outcome,
} from "./moves";
import { pileCards, withPile } from "./piles";
import type { CardRef } from "./piles";
import type { CascadeState, DragState, PressState } from "./game";

/** The distance between two points on the stage. */
function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * The pile a release would land the held run on, and whether it accepts it.
 *
 * The run resolves against the pile whose drop rectangle holds the CENTER of its
 * leading card, and the target is reported only while that pile would take the
 * run (specs/controls.md).
 */
export function withDropTarget(state: CascadeState): CascadeState {
  const drag = state.drag;
  if (drag === null) {
    return state.dropTarget === null ? state : { ...state, dropTarget: null };
  }
  const center = cardCenter(drag.x, drag.y);
  const ref = pileAtPoint(state, center.x, center.y);
  if (
    ref === null ||
    (ref.pile !== "foundation" && ref.pile !== "tableau") ||
    !accepts(state, drag.cards, ref)
  ) {
    return { ...state, dropTarget: null };
  }
  return { ...state, dropTarget: { pile: ref.pile, index: ref.index } };
}

/** The held run back on the pile it was lifted from, in the order it left. */
export function returnRun(state: CascadeState): CascadeState {
  const drag = state.drag;
  if (drag === null) return { ...state, dropTarget: null };
  const cards = pileCards(state, drag.fromPile, drag.fromIndex);
  return {
    ...withPile(state, drag.fromPile, drag.fromIndex, [
      ...cards,
      ...drag.cards,
    ]),
    drag: null,
    dropTarget: null,
  };
}

/** Whether a press at that point and time pairs with the press before it. */
export function isDoubleClick(
  previous: PressState | null,
  x: number,
  y: number,
  now: number,
): boolean {
  if (previous === null) return false;
  if (now - previous.at > DOUBLE_CLICK_WINDOW) return false;
  return distance(x, y, previous.x, previous.y) <= DOUBLE_CLICK_SLOP;
}

/** The run the press lifts into the hand, on the press itself. */
function grab(state: CascadeState, hit: CardRef): Outcome {
  if (hit.pile === "stock") return unchanged(state);
  const run = liftableRun(state, hit);
  if (run === null) return unchanged(state);

  const top = cardTopLeft(state, hit.pile, hit.index, hit.row);
  const drag: DragState = {
    cards: run,
    fromPile: hit.pile,
    fromIndex: hit.index,
    x: top.x,
    y: top.y,
  };
  const held = { ...detachRun(state, hit, run.length), drag };
  return { state: withDropTarget(held), cues: [CUES.lift] };
}

/**
 * A press at a stage point.
 *
 * On the won screen it deals a fresh game. On the table it either sends a card
 * home, when it pairs with the press before it into a double click on a playable
 * card, or lifts what the grab rule gives it.
 */
export function pointerDown(
  state: CascadeState,
  x: number,
  y: number,
): Outcome {
  const previous = state.lastPress;
  const pressed: CascadeState = {
    ...state,
    pointer: { x, y, down: true },
    lastPress: { x, y, at: state.simTime },
    // A finger never hovers, so the LANDING is what selects it; a mouse pressed
    // inside a region has moved onto it already, and selecting again changes
    // nothing (specs/controls.md).
    menuIndex: selectItemUnder(state, x, y),
  };

  if (pressed.screen === "won") return newGame(pressed);
  if (pressed.screen !== "playing") return unchanged(pressed);
  if (pressed.drag !== null) return unchanged(pressed);

  const hit = cardAtPoint(pressed, x, y);
  if (hit === null) return unchanged(pressed);

  if (isDoubleClick(previous, x, y, state.simTime)) {
    const playable = playableCard(pressed, hit.pile, hit.index);
    if (playable !== null && playable.row === hit.row) {
      const sent = autoMove(pressed, hit.pile, hit.index);
      return { state: sent.state, cues: sent.cues };
    }
  }

  return grab(pressed, hit);
}

/** A move to a stage point, which carries the held run the same distance. */
export function pointerMove(
  state: CascadeState,
  x: number,
  y: number,
): Outcome {
  const dx = x - state.pointer.x;
  const dy = y - state.pointer.y;
  const moved: CascadeState = {
    ...state,
    pointer: { ...state.pointer, x, y },
    // "A mouse moves onto an item's region, its button up or down" and "a finger
    // ... travels onto one while down" are the same sample here, and both select
    // (specs/controls.md).
    menuIndex: selectItemUnder(state, x, y),
    drag:
      state.drag === null
        ? null
        : { ...state.drag, x: state.drag.x + dx, y: state.drag.y + dy },
  };
  return unchanged(withDropTarget(moved));
}

/** What a control does when it is activated (specs/screens.md). */
function activate(state: CascadeState, control: ControlId): Outcome {
  switch (control) {
    case "title-new-game":
      // The title's entries also record what they were: specs/screens.md has
      // `titleIndex` follow the entry last activated there.
      return newGame({ ...state, titleIndex: 0 });
    case "hud-new-game":
      return newGame(state);
    case "title-how-to":
      return unchanged({
        ...state,
        titleIndex: 1,
        screen: "howto",
        menuIndex: 0,
      });
    case "howto-back":
    case "hud-menu":
      // "Both return to `title` with `menuIndex` set to `titleIndex`, the title
      // entry last activated" (specs/screens.md).
      return unchanged({
        ...state,
        screen: "title",
        menuIndex: wrapMenuIndex("title", state.titleIndex),
      });
    case "hud-sound":
      return unchanged({ ...state, muted: !state.muted });
  }
}

/**
 * Activate the item at `menuIndex` on the current screen.
 *
 * specs/controls.md: "The item every activation acts on is the item at
 * `menuIndex`, whichever input raised it, and the effect is the one the keyboard
 * table gives `menu-confirm` on that screen." So a key, a mouse click and a
 * finger tap all end here.
 */
export function activateMenuItem(state: CascadeState): Outcome {
  const control = menuControl(state.screen, state.menuIndex);
  return control === null ? unchanged(state) : activate(state, control);
}

/** Select the item whose region holds a point, where one does. */
function selectItemUnder(state: CascadeState, x: number, y: number): number {
  const index = menuItemAt(state.screen, x, y);
  return index === null ? state.menuIndex : index;
}

/** A click: the held run returns, and the stock answers where the press landed. */
function click(state: CascadeState, press: PressState): Outcome {
  const returned = returnRun(state);

  if (
    returned.screen === "playing" &&
    pointIn(cardRect(STOCK_X, TOP_ROW_Y), press.x, press.y)
  ) {
    return turnStock(returned);
  }

  return unchanged(returned);
}

/** A drop: the held run resolves against the drop rectangles. */
function drop(state: CascadeState): Outcome {
  const drag = state.drag;
  if (drag === null) return unchanged(state);

  const center = cardCenter(drag.x, drag.y);
  const target = pileAtPoint(state, center.x, center.y);
  if (target !== null && accepts(state, drag.cards, target)) {
    const landed = landRun(
      { ...state, drag: null, dropTarget: null },
      { pile: drag.fromPile, index: drag.fromIndex },
      drag.cards,
      target,
    );
    return { state: landed.state, cues: [CUES.drop, ...landed.cues] };
  }

  return { state: returnRun(state), cues: [CUES.reject] };
}

/**
 * A release at a stage point.
 *
 * A release within `DRAG_THRESHOLD` of its press is a click; anything farther is
 * a drop.
 */
export function pointerUp(state: CascadeState, x: number, y: number): Outcome {
  const released: CascadeState = {
    ...state,
    pointer: { x, y, down: false },
  };
  const press = state.lastPress;
  if (press === null) return unchanged(released);

  // The menu first, and whatever KIND of gesture this was: specs/controls.md has
  // either kind activate a control "when one control's hit region holds both the
  // press point and the release point".
  const pressedItem = menuItemAt(released.screen, press.x, press.y);
  if (
    pressedItem !== null &&
    pressedItem === menuItemAt(released.screen, x, y)
  ) {
    return activateMenuItem({
      ...returnRun(released),
      menuIndex: pressedItem,
    });
  }

  return distance(x, y, press.x, press.y) <= DRAG_THRESHOLD
    ? click(released, press)
    : drop(released);
}
