// Cascade — the pointer, and every control it answers (`specs/controls.md`).
//
// One function resolves one pointer sample, and everything that reaches the
// game through a pointer goes through it: the frame's samples from the page's
// own events, and the debug surface's `pointerDown`, `pointerMove` and
// `pointerUp`. So a posed press and a player's press are the same event to the
// game, and the hit test, the grab rule, the drop rule and the double-click
// rule all run exactly once, here.
//
// A gesture runs from a press to the release that follows it, and the RELEASE
// decides which kind it was: within `DRAG_THRESHOLD` of the press it is a
// click, which returns any held run, activates the control the press landed in,
// and turns the stock; beyond it, it is a drop, resolved against the drop
// rectangles `specs/table.md` fixes.

import type { AudioPort } from "./audio-bus";
import {
  CARD_H,
  CARD_W,
  CUES,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  FOUNDATION_COUNT,
  HOWTO_BACK,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TABLEAU_COLUMNS,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
} from "./constants";
import {
  accepts,
  autoMove,
  detachRun,
  landRun,
  returnRun,
  startNewGame,
  turnStock,
  wasteTopCard,
} from "./board";
import type { PointerSample } from "./pointer";
import type { CascadeState } from "./state";
import {
  columnCardRect,
  foundationRect,
  stockRect,
  wasteRect,
  zoneAt,
} from "./table";
import type { PileRef, SourcePile } from "./types";
import { pointInRect } from "./types";

/** Feed one pointer sample to the game, resolved before the call returns. */
export function resolvePointer(
  state: CascadeState,
  sample: PointerSample,
  audio: AudioPort,
): void {
  switch (sample.type) {
    case "down":
      pressAt(state, sample.x, sample.y);
      return;
    case "move":
      moveTo(state, sample.x, sample.y);
      return;
    case "up":
      releaseAt(state, sample.x, sample.y, audio);
  }
}

/* ---- The press ----------------------------------------------------------- */

function pressAt(state: CascadeState, x: number, y: number): void {
  state.pointer = { x, y, down: true };

  // A press arriving while a run is somehow still in hand puts that run back
  // before anything else looks at the table, so no gesture ever starts from a
  // board with cards missing from it.
  if (state.drag !== null) returnHeldRun(state);

  const doubleClicked = isDoubleClick(state, x, y);
  state.lastPress = { x, y, at: state.simTime };
  state.gesture = { x, y, spent: false };

  if (state.screen === "won") {
    // A press anywhere, during the cascade or after it, deals a fresh game.
    startNewGame(state);
    state.gesture = { x, y, spent: true };
    return;
  }
  if (state.screen !== "playing") return;

  if (doubleClicked) {
    const playable = playableAt(state, x, y);
    if (playable !== null) autoMove(state, playable.pile, playable.index);
    state.gesture = { x, y, spent: true };
    return;
  }

  grabAt(state, x, y);
}

/**
 * Whether this press is the second of a double click: inside the window, inside
 * the slop, and landing on a playable card.
 */
function isDoubleClick(state: CascadeState, x: number, y: number): boolean {
  const last = state.lastPress;
  if (last === null) return false;
  if (state.screen !== "playing") return false;
  if (state.simTime - last.at > DOUBLE_CLICK_WINDOW) return false;
  if (Math.hypot(x - last.x, y - last.y) > DOUBLE_CLICK_SLOP) return false;
  return playableAt(state, x, y) !== null;
}

/**
 * The pile whose playable card lies under the point: the waste's shown top
 * card, or a column's lowest face-up card.
 */
export function playableAt(
  state: CascadeState,
  x: number,
  y: number,
): PileRef | null {
  if (pointInRect(x, y, wasteRect()) && wasteTopCard(state) !== null) {
    return { pile: "waste", index: 0 };
  }
  for (let index = 0; index < TABLEAU_COLUMNS; index += 1) {
    const column = state.tableau[index];
    if (column.length === 0) continue;
    const row = column.length - 1;
    if (!column[row].faceUp) continue;
    if (pointInRect(x, y, columnCardRect(index, column, row))) {
      return { pile: "tableau", index };
    }
  }
  return null;
}

/**
 * Lift whatever the press picked up, on the press itself.
 *
 * The run leaves its pile as it enters the hand, so that pile holds only the
 * cards left behind for as long as the gesture lasts.
 */
function grabAt(state: CascadeState, x: number, y: number): void {
  const grab = grabTarget(state, x, y);
  if (grab === null) return;
  const cards = detachRun(
    state,
    { pile: grab.pile, index: grab.index },
    grab.count,
  );
  if (cards.length === 0) return;
  state.drag = {
    cards,
    fromPile: grab.pile,
    fromIndex: grab.index,
    x: grab.x,
    y: grab.y,
    grabDX: x - grab.x,
    grabDY: y - grab.y,
  };
  state.cues.raise(CUES.lift);
  updateDropTarget(state);
}

/** What a press at a point lifts, or `null` when it lifts nothing. */
interface GrabTarget {
  pile: SourcePile;
  index: number;
  /** How many cards leave the pile, counted off its top. */
  count: number;
  /** The leading card's top-left where it lay. */
  x: number;
  y: number;
}

function grabTarget(
  state: CascadeState,
  x: number,
  y: number,
): GrabTarget | null {
  // A press on the stock lifts nothing: the stock is turned by the click that
  // follows, never dragged.
  if (pointInRect(x, y, stockRect())) return null;

  const waste = wasteRect();
  if (pointInRect(x, y, waste)) {
    return wasteTopCard(state) === null
      ? null
      : { pile: "waste", index: 0, count: 1, x: waste.x, y: waste.y };
  }

  for (let index = 0; index < FOUNDATION_COUNT; index += 1) {
    const rect = foundationRect(index);
    if (!pointInRect(x, y, rect)) continue;
    return state.foundations[index].length === 0
      ? null
      : { pile: "foundation", index, count: 1, x: rect.x, y: rect.y };
  }

  for (let index = 0; index < TABLEAU_COLUMNS; index += 1) {
    const column = state.tableau[index];
    if (column.length === 0) continue;
    // The card drawn over every other card at the point is the LOWEST of the
    // cards whose footprint contains it, so the scan runs from the bottom up.
    for (let row = column.length - 1; row >= 0; row -= 1) {
      const rect = columnCardRect(index, column, row);
      if (!pointInRect(x, y, rect)) continue;
      if (!column[row].faceUp) return null;
      return {
        pile: "tableau",
        index,
        count: column.length - row,
        x: rect.x,
        y: rect.y,
      };
    }
  }
  return null;
}

/* ---- The move ------------------------------------------------------------ */

function moveTo(state: CascadeState, x: number, y: number): void {
  state.pointer = { x, y, down: state.pointer.down };
  const drag = state.drag;
  if (drag === null) return;
  // The run keeps the offset between the press point and the leading card's
  // top-left, so it travels exactly as far as the pointer does.
  drag.x = x - drag.grabDX;
  drag.y = y - drag.grabDY;
  updateDropTarget(state);
}

/**
 * The pile a release would land the held run on: the one whose drop rectangle
 * holds the leading card's centre, and only while that pile accepts the run.
 */
export function updateDropTarget(state: CascadeState): void {
  const drag = state.drag;
  if (drag === null) {
    state.dropTarget = null;
    return;
  }
  const zone = zoneAt(
    drag.x + CARD_W / 2,
    drag.y + CARD_H / 2,
    state.foundations,
    state.tableau,
  );
  if (zone === null || zone.pile === "stock" || zone.pile === "waste") {
    state.dropTarget = null;
    return;
  }
  const target = { pile: zone.pile, index: zone.index };
  state.dropTarget = accepts(state, target, drag.cards) ? target : null;
}

/* ---- The release --------------------------------------------------------- */

function releaseAt(
  state: CascadeState,
  x: number,
  y: number,
  audio: AudioPort,
): void {
  state.pointer = { x, y, down: false };
  // The release is a pointer position like any other, so a run still in hand
  // follows it before the gesture is judged. That is what makes a press and a
  // release with no move between them resolve where the release landed.
  if (state.drag !== null) {
    state.drag.x = x - state.drag.grabDX;
    state.drag.y = y - state.drag.grabDY;
    updateDropTarget(state);
  }
  const gesture = state.gesture;
  state.gesture = null;
  // A release with no press behind it, and the release that follows a double
  // click, both change nothing.
  if (gesture === null || gesture.spent) return;

  const click = Math.hypot(x - gesture.x, y - gesture.y) <= DRAG_THRESHOLD;
  if (click) {
    // In this order: the held run goes back, then the control the press landed
    // in is activated, then the stock is turned.
    if (state.drag !== null) returnHeldRun(state);
    if (activateControl(state, gesture.x, gesture.y, audio)) return;
    if (
      state.screen === "playing" &&
      pointInRect(gesture.x, gesture.y, stockRect())
    ) {
      turnStock(state);
    }
    return;
  }
  dropHeldRun(state);
}

/** Resolve a drop against the drop rectangles, and apply or return the run. */
function dropHeldRun(state: CascadeState): void {
  const drag = state.drag;
  if (drag === null) return;
  const target = state.dropTarget;
  const source = { pile: drag.fromPile, index: drag.fromIndex };
  if (target === null) {
    returnRun(state, source, drag.cards);
    state.cues.raise(CUES.reject);
  } else {
    landRun(state, source, target, drag.cards);
    state.cues.raise(CUES.drop);
  }
  state.drag = null;
  state.dropTarget = null;
}

/** Put the held run back where it was lifted from, with every face unchanged. */
function returnHeldRun(state: CascadeState): void {
  const drag = state.drag;
  if (drag === null) return;
  returnRun(state, { pile: drag.fromPile, index: drag.fromIndex }, drag.cards);
  state.drag = null;
  state.dropTarget = null;
}

/**
 * Activate the control whose hit rectangle holds the press point, and report
 * whether one answered. A control answers only on the screen it belongs to.
 */
function activateControl(
  state: CascadeState,
  x: number,
  y: number,
  audio: AudioPort,
): boolean {
  if (state.screen === "title") {
    if (pointInRect(x, y, TITLE_NEW_GAME)) {
      startNewGame(state);
      return true;
    }
    if (pointInRect(x, y, TITLE_HOW_TO)) {
      state.screen = "howto";
      return true;
    }
    return false;
  }
  if (state.screen === "howto") {
    if (pointInRect(x, y, HOWTO_BACK)) {
      state.screen = "title";
      return true;
    }
    return false;
  }
  if (state.screen !== "playing") return false;
  if (pointInRect(x, y, HUD_NEW_GAME)) {
    startNewGame(state);
    return true;
  }
  if (pointInRect(x, y, HUD_MENU)) {
    state.screen = "title";
    return true;
  }
  if (pointInRect(x, y, HUD_SOUND)) {
    audio.setMuted(!audio.muted());
    // Mirrored at once as well as in every update, so the bit the snapshot
    // reports is the bit the runtime holds the instant the control answered.
    state.muted = audio.muted();
    return true;
  }
  return false;
}
