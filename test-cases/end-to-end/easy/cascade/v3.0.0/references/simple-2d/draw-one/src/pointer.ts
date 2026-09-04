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
  controlAtPoint,
  pileAtPoint,
  pointIn,
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
    drag:
      state.drag === null
        ? null
        : { ...state.drag, x: state.drag.x + dx, y: state.drag.y + dy },
  };
  return unchanged(withDropTarget(moved));
}

/** What a control does when a click activates it (specs/screens.md). */
function activate(state: CascadeState, control: ControlId): Outcome {
  switch (control) {
    case "title-new-game":
    case "hud-new-game":
      return newGame(state);
    case "title-how-to":
      return unchanged({ ...state, screen: "howto" });
    case "howto-back":
    case "hud-menu":
      return unchanged({ ...state, screen: "title" });
    case "hud-sound":
      return unchanged({ ...state, muted: !state.muted });
  }
}

/** A click: the held run returns, and whatever the press landed in answers. */
function click(state: CascadeState, press: PressState): Outcome {
  const returned = returnRun(state);

  const control = controlAtPoint(returned.screen, press.x, press.y);
  if (control !== null) return activate(returned, control);

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

  return distance(x, y, press.x, press.y) <= DRAG_THRESHOLD
    ? click(released, press)
    : drop(released);
}
