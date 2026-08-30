// Cascade — the pointer (`specs/controls.md`).
//
// Every gesture the game answers is resolved here, and every sample is resolved
// ON ITS OWN, in the order it arrived, so a press and the release that followed
// it inside one frame both take effect and a gesture is never reduced to the last
// position of the frame that carried it. The player controller drains the frame's
// sample list into these three functions, and the debug surface's pointer
// operations call the same three, so a posed press and a player's press are the
// same event to the game.
//
// A mouse and a touchscreen stand on the same footing because nothing here knows
// which one it is: the engine reports one pointer in the stage's logical units,
// and a press, a move and a release are all this file reads.
//
// The shape of a gesture:
//
//   - A PRESS lifts what the pile under it offers, and the run enters the hand on
//     the press itself, before the pointer has moved at all. Two presses close
//     enough in time and in place, on a playable card, are a DOUBLE CLICK
//     instead, which lifts nothing and sends the card home.
//   - A MOVE carries the run by exactly as far as the pointer travelled, so the
//     offset between the press point and the leading card's top-left is kept, and
//     recomputes the drop target under it.
//   - A RELEASE is a CLICK when it lands within `DRAG_THRESHOLD` of its press and
//     a DROP otherwise. A click returns any held run, activates the control its
//     press landed in, and turns the stock; a drop resolves the run against the
//     drop rectangles and activates nothing.

import {
  autoMoveFrom,
  landRun,
  liftRun,
  playableRow,
  returnRun,
} from "./moves";
import type { FrameEvents } from "./audio";
import {
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  HOWTO_BACK,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
} from "./constants";
import { newGame, toTitle } from "./flow";
import type { CascadeState } from "./game";
import {
  cardAtPoint,
  cardCenter,
  dropRect,
  pileAtPoint,
  rectContains,
} from "./layout";
import { accepts } from "./moves";
import { turnStock } from "./stock";

/** The distance between two stage points. */
function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * The pile a release would land the held run on: the pile whose drop rectangle
 * contains the CENTRE of the run's leading card, and only while that pile would
 * accept the run. It is recomputed as the pointer moves.
 */
export function refreshDropTarget(state: CascadeState): void {
  state.dropTarget = null;
  const drag = state.drag;
  if (drag === null) return;

  const centre = cardCenter(drag.x, drag.y);
  const ref = pileAtPoint(state, centre.x, centre.y);
  if (ref === null) return;
  if (ref.pile !== "foundation" && ref.pile !== "tableau") return;

  const from = { pile: drag.fromPile, index: drag.fromIndex };
  if (!accepts(state, drag.cards, from, ref.pile, ref.index)) return;

  state.dropTarget = { pile: ref.pile, index: ref.index };
}

/** Whether the card under a press is one the double click could send home. */
function playableHit(state: CascadeState, x: number, y: number): boolean {
  const hit = cardAtPoint(state, x, y);
  if (hit === null) return false;
  return playableRow(state, hit.pile, hit.index) === hit.row;
}

/** Lift what the pile under a press offers, into the hand, on the press itself. */
function grab(
  state: CascadeState,
  x: number,
  y: number,
  events: FrameEvents,
): void {
  const hit = cardAtPoint(state, x, y);
  if (hit === null) return;

  const lifted = liftRun(state, hit.pile, hit.index, hit.row);
  if (lifted === null) return;

  state.drag = {
    cards: lifted.run,
    fromPile: lifted.from.pile,
    fromIndex: lifted.from.index,
    x: hit.x,
    y: hit.y,
  };
  events.lift = true;
  refreshDropTarget(state);
}

/**
 * Activate the control whose rectangle contains a click's press point. A control
 * answers only on the screen it belongs to.
 */
function activateControl(
  state: CascadeState,
  x: number,
  y: number,
  events: FrameEvents,
): void {
  switch (state.screen) {
    case "title":
      if (rectContains(TITLE_NEW_GAME, x, y)) newGame(state, events);
      else if (rectContains(TITLE_HOW_TO, x, y)) state.screen = "howto";
      return;
    case "howto":
      if (rectContains(HOWTO_BACK, x, y)) toTitle(state);
      return;
    case "playing":
      if (rectContains(HUD_NEW_GAME, x, y)) newGame(state, events);
      else if (rectContains(HUD_MENU, x, y)) toTitle(state);
      else if (rectContains(HUD_SOUND, x, y)) events.toggleMute = true;
      return;
    case "won":
      return;
  }
}

/** A press at a logical stage point. */
export function pointerDown(
  state: CascadeState,
  x: number,
  y: number,
  events: FrameEvents,
): void {
  const previous = state.lastPress;
  state.pointer = { x, y, down: true };
  // Every press records its point and the game time it arrived at, and that is
  // the press the next one is measured against.
  state.lastPress = { x, y, at: state.simTime };

  if (state.screen === "won") {
    // A press anywhere, during the cascade or after it, deals a fresh game and
    // moves to `playing` (`specs/victory.md`). The whole gesture is spent on the
    // press: it leaves no press behind, so the release that follows resolves
    // nothing and cannot activate a HUD control the fresh table has only just
    // put under it, and the next press pairs with no double click.
    newGame(state, events);
    state.lastPress = null;
    return;
  }
  // On `title` and `howto` the pointer answers the controls, which a CLICK
  // activates on its release.
  if (state.screen !== "playing") return;

  const doubled =
    previous !== null &&
    state.simTime - previous.at <= DOUBLE_CLICK_WINDOW &&
    distance(x, y, previous.x, previous.y) <= DOUBLE_CLICK_SLOP;

  if (doubled && playableHit(state, x, y)) {
    // A double click lifts nothing: the card under it goes to the foundation it
    // belongs on, when one accepts it, and the gesture ends there.
    const hit = cardAtPoint(state, x, y);
    if (hit !== null) autoMoveFrom(state, hit.pile, hit.index, events);
    return;
  }

  grab(state, x, y, events);
}

/** A move to a logical stage point. */
export function pointerMove(
  state: CascadeState,
  x: number,
  y: number,
  _events: FrameEvents,
): void {
  const dx = x - state.pointer.x;
  const dy = y - state.pointer.y;
  state.pointer.x = x;
  state.pointer.y = y;

  const drag = state.drag;
  if (drag === null) return;
  // The run keeps the offset between the press point and its leading card's
  // top-left, so it travels exactly as far as the pointer does.
  drag.x += dx;
  drag.y += dy;
  refreshDropTarget(state);
}

/** A release at a logical stage point. */
export function pointerUp(
  state: CascadeState,
  x: number,
  y: number,
  events: FrameEvents,
): void {
  const held = state.pointer.down;
  const press = state.lastPress;
  const dx = x - state.pointer.x;
  const dy = y - state.pointer.y;
  state.pointer = { x, y, down: false };

  const drag = state.drag;
  if (drag !== null) {
    drag.x += dx;
    drag.y += dy;
  }

  // A release that no press opened changes nothing.
  if (!held || press === null) return;

  if (distance(x, y, press.x, press.y) <= DRAG_THRESHOLD) {
    resolveClick(state, drag, press.x, press.y, events);
    return;
  }
  resolveDrop(state, drag, events);
}

/** A click: return the run, activate the control, turn the stock, in that order. */
function resolveClick(
  state: CascadeState,
  drag: CascadeState["drag"],
  pressX: number,
  pressY: number,
  events: FrameEvents,
): void {
  if (drag !== null) {
    returnRun(state, {
      run: drag.cards,
      from: { pile: drag.fromPile, index: drag.fromIndex },
    });
    state.drag = null;
  }
  state.dropTarget = null;

  activateControl(state, pressX, pressY, events);

  if (state.screen !== "playing") return;
  const stock = dropRect(state, "stock", 0);
  if (stock !== null && rectContains(stock, pressX, pressY)) {
    turnStock(state, events);
  }
}

/** A drop: resolve the run against the drop rectangles. It activates nothing. */
function resolveDrop(
  state: CascadeState,
  drag: CascadeState["drag"],
  events: FrameEvents,
): void {
  state.dropTarget = null;
  if (drag === null) return;
  state.drag = null;

  const lifted = {
    run: drag.cards,
    from: { pile: drag.fromPile, index: drag.fromIndex },
  };
  const centre = cardCenter(drag.x, drag.y);
  const ref = pileAtPoint(state, centre.x, centre.y);

  if (ref === null) {
    returnRun(state, lifted);
    events.reject = true;
    return;
  }
  if (landRun(state, lifted, ref.pile, ref.index, events)) events.drop = true;
  else events.reject = true;
}
