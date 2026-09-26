// Cascade — what the pointer does (specs/controls.md).
//
// Every sample is resolved ON ITS OWN, the moment it arrives, so a press and
// the release that followed it inside one frame both take effect and a gesture
// is never reduced to the last position of the frame that carried it. The
// player controller drains the frame's ordered samples through these three
// functions, and the debug surface's pointer operations call the very same
// three — which is why a posed press and a player's press are the same event to
// the game.
//
// The three rules this file owns:
//
//   A press lifts. The run enters the hand ON THE PRESS ITSELF, before the
//   pointer has moved at all, and it LEAVES the pile it was lifted from as it
//   does, so that pile holds only what was left behind for as long as the
//   gesture lasts.
//
//   A release within `DRAG_THRESHOLD` of its press is a CLICK: it returns any
//   held run, activates the control the press landed in, and turns the stock
//   when the press landed on it. A release farther off is a DROP, which
//   resolves the run against the drop rectangles `specs/table.md` fixes and
//   activates nothing.
//
//   A second press inside `DOUBLE_CLICK_WINDOW` and `DOUBLE_CLICK_SLOP` of the
//   one before it, landing on a playable card, is a DOUBLE CLICK: it lifts
//   nothing and sends that card to the foundation it belongs on.

import type { FrameCues } from "./audio";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  FOUNDATION_X,
} from "./constants";
import { newGame, toTitle } from "./flow";
import type { CardState, CascadeState, PileKind } from "./game";
import {
  cardTopLeft,
  columnCardY,
  dropRect,
  inRect,
  pileAt,
  wasteShownCards,
} from "./layout";
import {
  autoMoveFrom,
  landRun,
  playableCard,
  returnRun,
  takeRun,
  type RunSource,
} from "./moves";
import { pileArray } from "./piles";
import { columnAccepts, foundationAccepts } from "./rules";
import { turnStock } from "./stock";
import { menuItemAt } from "./menus";

/** A card the pointer resolved to, with the top-left it is drawn at. */
export interface CardHit {
  pile: PileKind;
  index: number;
  row: number;
  card: CardState;
  x: number;
  y: number;
}

/**
 * The card drawn over every other card at a point, which in a column is the
 * lowest of the cards whose footprint contains it. `null` where the point lands
 * on no card, the stock included: the stock lifts nothing.
 */
export function hitCard(
  state: CascadeState,
  x: number,
  y: number,
): CardHit | null {
  for (let col = 0; col < COLUMN_X.length; col += 1) {
    const column = state.tableau[col];
    if (column.length === 0) continue;
    if (x < COLUMN_X[col] || x > COLUMN_X[col] + CARD_W) continue;
    for (let row = column.length - 1; row >= 0; row -= 1) {
      const top = columnCardY(column, row);
      if (y >= top && y <= top + CARD_H) {
        return {
          pile: "tableau",
          index: col,
          row,
          card: column[row],
          x: COLUMN_X[col],
          y: top,
        };
      }
    }
  }

  const shown = wasteShownCards(state);
  if (shown.length > 0 && inRect(dropRect(state, "waste", 0), x, y)) {
    const row = state.waste.length - 1;
    const [cx, cy] = cardTopLeft(state, "waste", 0, row);
    return {
      pile: "waste",
      index: 0,
      row,
      card: state.waste[row],
      x: cx,
      y: cy,
    };
  }

  for (let i = 0; i < FOUNDATION_X.length; i += 1) {
    const foundation = state.foundations[i];
    if (foundation.length === 0) continue;
    if (!inRect(dropRect(state, "foundation", i), x, y)) continue;
    const row = foundation.length - 1;
    const [cx, cy] = cardTopLeft(state, "foundation", i, row);
    return {
      pile: "foundation",
      index: i,
      row,
      card: foundation[row],
      x: cx,
      y: cy,
    };
  }

  return null;
}

/** The pile a held run would land on, when that pile accepts it. */
export function updateDropTarget(state: CascadeState): void {
  const drag = state.drag;
  if (drag === null) {
    state.dropTarget = null;
    return;
  }
  const under = pileAt(state, drag.x + CARD_W / 2, drag.y + CARD_H / 2);
  if (under === null || under.pile === "stock" || under.pile === "waste") {
    state.dropTarget = null;
    return;
  }
  const cards = pileArray(state, under.pile, under.index);
  const accepts =
    cards !== null &&
    (under.pile === "foundation"
      ? foundationAccepts(cards, drag.cards)
      : columnAccepts(cards, drag.cards));
  state.dropTarget = accepts ? { pile: under.pile, index: under.index } : null;
}

/**
 * Whether this press pairs with the one before it into a double click: inside
 * the window, inside the slop, and landing on a playable card.
 */
function isDoubleClick(state: CascadeState, x: number, y: number): boolean {
  const press = state.lastPress;
  if (press === null) return false;
  if (state.simTime - press.at > DOUBLE_CLICK_WINDOW) return false;
  if (Math.hypot(x - press.x, y - press.y) > DOUBLE_CLICK_SLOP) return false;
  const hit = hitCard(state, x, y);
  if (hit === null) return false;
  const playable = playableCard(state, hit.pile, hit.index);
  return playable !== null && playable.card.id === hit.card.id;
}

/** Put the run the press landed on into the hand, and highlight what would take it. */
function liftAt(
  state: CascadeState,
  x: number,
  y: number,
  cues: FrameCues,
): void {
  if (state.drag !== null) return;
  const hit = hitCard(state, x, y);
  if (hit === null) return;
  const run = takeRun(state, hit.pile, hit.index, hit.row);
  if (run === null) return;
  state.drag = {
    cards: run,
    fromPile: hit.pile as RunSource["pile"],
    fromIndex: hit.index,
    x: hit.x,
    y: hit.y,
  };
  cues.lift = true;
  updateDropTarget(state);
}

/** A press at a logical stage point. */
export function pointerDown(
  state: CascadeState,
  x: number,
  y: number,
  cues: FrameCues,
): void {
  const doubleClick = state.screen === "playing" && isDoubleClick(state, x, y);

  state.pointer.x = x;
  state.pointer.y = y;
  state.pointer.down = true;
  state.lastPress = { x, y, at: state.simTime };
  // A finger never hovers, so the LANDING is what selects it; a mouse pressed
  // inside a region has moved onto it already, and selecting again changes
  // nothing (specs/controls.md).
  selectItemUnder(state, x, y);

  if (state.screen === "won") {
    // A press anywhere, during the cascade or after it, deals a fresh game
    // (specs/victory.md). The gesture is spent on the press, so it leaves no
    // press behind for the release or for a double click to pair with.
    newGame(state, cues);
    state.lastPress = null;
    return;
  }
  if (state.screen !== "playing") return;

  if (doubleClick) {
    const hit = hitCard(state, x, y);
    // A double click lifts nothing; the card under it goes home if a
    // foundation takes it, and the release that follows changes nothing.
    if (hit !== null) autoMoveFrom(state, hit.pile, hit.index, cues);
    return;
  }

  liftAt(state, x, y, cues);
}

/** A move to a logical stage point. */
export function pointerMove(
  state: CascadeState,
  x: number,
  y: number,
  _cues: FrameCues,
): void {
  const dx = x - state.pointer.x;
  const dy = y - state.pointer.y;
  state.pointer.x = x;
  state.pointer.y = y;
  // "A mouse moves onto an item's region, its button up or down" and "a finger
  // ... travels onto one while down" are the same sample here, and both select
  // (specs/controls.md).
  selectItemUnder(state, x, y);
  if (state.drag === null) return;
  // The run keeps the offset it was lifted at, so it travels exactly as far as
  // the pointer does (specs/controls.md).
  state.drag.x += dx;
  state.drag.y += dy;
  updateDropTarget(state);
}

/**
 * Activate the item at `menuIndex` on the current screen (specs/screens.md).
 *
 * specs/controls.md: "The item every activation acts on is the item at
 * `menuIndex`, whichever input raised it, and the effect is the one the keyboard
 * table gives `menu-confirm` on that screen." So a key, a mouse click and a
 * finger tap all end here.
 *
 * The title's two entries also record what they were: specs/screens.md has
 * `titleIndex` follow the entry last activated there, and both returns to the
 * title restore `menuIndex` from it ({@link toTitle}).
 */
export function activateMenuItem(state: CascadeState, cues: FrameCues): void {
  const index = state.menuIndex;
  switch (state.screen) {
    case "title":
      if (index === 0) {
        state.titleIndex = 0;
        newGame(state, cues);
      } else if (index === 1) {
        state.titleIndex = 1;
        state.screen = "howto";
        state.menuIndex = 0;
      }
      return;
    case "howto":
      toTitle(state);
      return;
    case "playing":
      if (index === 0) newGame(state, cues);
      else if (index === 1) toTitle(state);
      else if (index === 2) cues.muteToggle = true;
      return;
    case "won":
      return;
  }
}

/** The stock, which a click turns when the press landed in its rectangle. */
function clickOnStock(
  state: CascadeState,
  x: number,
  y: number,
  cues: FrameCues,
): void {
  if (state.screen !== "playing") return;
  if (inRect(dropRect(state, "stock", 0), x, y)) turnStock(state, cues);
}

/** Select the item whose region holds a point, where one does. */
function selectItemUnder(state: CascadeState, x: number, y: number): void {
  const index = menuItemAt(state.screen, x, y);
  if (index !== null) state.menuIndex = index;
}

/** A release at a logical stage point. */
export function pointerUp(
  state: CascadeState,
  x: number,
  y: number,
  cues: FrameCues,
): void {
  const dx = x - state.pointer.x;
  const dy = y - state.pointer.y;
  if (state.drag !== null) {
    state.drag.x += dx;
    state.drag.y += dy;
  }
  state.pointer.x = x;
  state.pointer.y = y;
  state.pointer.down = false;

  const press = state.lastPress;
  const drag = state.drag;

  // The menu first, and whatever KIND of gesture this was: specs/controls.md has
  // either kind activate a control "when one control's hit region holds both the
  // press point and the release point".
  const pressed =
    press === null ? null : menuItemAt(state.screen, press.x, press.y);
  if (pressed !== null && pressed === menuItemAt(state.screen, x, y)) {
    if (drag !== null) {
      returnRun(state, drag.cards, {
        pile: drag.fromPile,
        index: drag.fromIndex,
      });
      state.drag = null;
    }
    state.dropTarget = null;
    state.menuIndex = pressed;
    activateMenuItem(state, cues);
    return;
  }

  const click =
    press !== null && Math.hypot(x - press.x, y - press.y) <= DRAG_THRESHOLD;

  if (click) {
    if (drag !== null) {
      returnRun(state, drag.cards, {
        pile: drag.fromPile,
        index: drag.fromIndex,
      });
      state.drag = null;
    }
    state.dropTarget = null;
    if (press !== null) clickOnStock(state, press.x, press.y, cues);
    return;
  }

  if (drag === null) return;

  // A drop resolves to the pile whose drop rectangle contains the center of the
  // run's leading card, which is the card drawn at the top of the held run.
  const under = pileAt(state, drag.x + CARD_W / 2, drag.y + CARD_H / 2);
  const source: RunSource = { pile: drag.fromPile, index: drag.fromIndex };
  state.drag = null;
  state.dropTarget = null;

  if (
    under !== null &&
    landRun(state, drag.cards, source, under.pile, under.index, cues)
  ) {
    cues.drop = true;
    return;
  }
  returnRun(state, drag.cards, source);
  cues.reject = true;
}
