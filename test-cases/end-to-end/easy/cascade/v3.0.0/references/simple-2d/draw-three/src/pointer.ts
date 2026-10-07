// Cascade — the pointer (`specs/controls.md`).
//
// One press, one move and one release, each resolved the moment it arrives. The
// engine hands `update` every sample the frame delivered, in the order it
// arrived, and the debug surface's `pointerDown`, `pointerMove` and `pointerUp`
// feed these same three functions, so a posed press and a player's press are the
// same event to the game and nothing is bypassed.
//
// The run enters the hand on the PRESS itself, before the pointer has moved at
// all, and it leaves the pile it was lifted from as it does. What the release
// then decides is which kind of gesture it was: a release within
// `DRAG_THRESHOLD` of its press is a CLICK, which returns the run, activates a
// control and turns the stock; anything farther is a DROP, resolved against the
// drop rectangles `specs/table.md` fixes.

import {
  CUES,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
} from "./constants";
import {
  cardAt,
  dropRect,
  leadingCenter,
  rectContains,
  zoneAt,
} from "./layout";
import {
  acceptsRun,
  autoMoveFrom,
  completeLanding,
  grabbableRun,
  newGame,
  refreshDropTarget,
  returnHeldRun,
  turnStock,
} from "./table";
import { pileOf, raise, visibleCount, type Sim } from "./sim";
import type { PileKind } from "./game";
import { menuItemAt, wrapMenuIndex } from "./menus";

/** A pile a gesture can act on. */
interface PlayablePile {
  readonly pile: PileKind;
  readonly index: number;
}

/**
 * The playable card under `(x, y)`, as the pile that holds it, or `null`.
 *
 * A playable card is the waste's shown top card or a column's lowest face-up
 * card, which is what the double click is measured against.
 */
function playableAt(sim: Sim, x: number, y: number): PlayablePile | null {
  const hit = cardAt(sim, x, y);
  if (hit === null) return null;

  if (hit.pile === "waste") {
    if (hit.row !== sim.waste.length - 1) return null;
    if (visibleCount(sim.wasteSets) <= 0) return null;
    return { pile: "waste", index: 0 };
  }
  if (hit.pile === "tableau") {
    const column = sim.tableau[hit.index] ?? [];
    if (hit.row !== column.length - 1) return null;
    if (!hit.card.faceUp) return null;
    return { pile: "tableau", index: hit.index };
  }
  return null;
}

/** Whether a press at `(x, y)` follows its predecessor closely enough to pair. */
function pairsWithLastPress(sim: Sim, x: number, y: number): boolean {
  const press = sim.lastPress;
  if (press === null) return false;
  if (sim.simTime - press.at > DOUBLE_CLICK_WINDOW) return false;
  return Math.hypot(x - press.x, y - press.y) <= DOUBLE_CLICK_SLOP;
}

/** Lift what the press at `(x, y)` picks up into the hand. */
function grabAt(sim: Sim, x: number, y: number): void {
  const hit = cardAt(sim, x, y);
  if (hit === null) return;
  if (hit.pile === "stock") return;

  const run = grabbableRun(sim, hit.pile, hit.index, hit.row);
  if (run === null) return;
  const source = pileOf(sim, hit.pile, hit.index);
  if (source === null) return;

  source.splice(hit.row);
  sim.drag = {
    cards: run,
    fromPile: hit.pile,
    fromIndex: hit.index,
    x: hit.x,
    y: hit.y,
  };
  raise(sim, CUES.lift);
  refreshDropTarget(sim);
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
 * title restore `menuIndex` from it.
 */
export function activateMenuItem(sim: Sim): void {
  const index = sim.menuIndex;
  switch (sim.screen) {
    case "title":
      if (index === 0) {
        sim.titleIndex = 0;
        newGame(sim);
      } else if (index === 1) {
        sim.titleIndex = 1;
        sim.screen = "howto";
        sim.menuIndex = 0;
      }
      return;
    case "howto":
      returnToTitle(sim);
      return;
    case "playing":
      if (index === 0) newGame(sim);
      else if (index === 1) returnToTitle(sim);
      else if (index === 2) sim.muted = !sim.muted;
      return;
    case "won":
      return;
  }
}

/** Leave for the title, with the entry that led away from it selected. */
function returnToTitle(sim: Sim): void {
  sim.screen = "title";
  sim.menuIndex = wrapMenuIndex("title", sim.titleIndex);
}

/** Select the item whose region holds a point, where one does. */
function selectItemUnder(sim: Sim, x: number, y: number): void {
  const index = menuItemAt(sim.screen, x, y);
  if (index !== null) sim.menuIndex = index;
}

/** Land or return the held run, by where its leading card's centre lies. */
function resolveDrop(sim: Sim): void {
  const drag = sim.drag;
  if (drag === null) return;

  const centre = leadingCenter(drag.x, drag.y);
  const zone = zoneAt(sim, centre.x, centre.y);
  if (
    zone !== null &&
    (zone.pile === "foundation" || zone.pile === "tableau") &&
    acceptsRun(sim, zone.pile, zone.index, drag.cards)
  ) {
    sim.drag = null;
    sim.dropTarget = null;
    raise(sim, CUES.drop);
    completeLanding(
      sim,
      drag.cards,
      { pile: drag.fromPile, index: drag.fromIndex },
      { pile: zone.pile, index: zone.index },
    );
    return;
  }

  returnHeldRun(sim);
  raise(sim, CUES.reject);
}

/** A press at a logical stage point. */
export function pressAt(sim: Sim, x: number, y: number): void {
  // A press with a run already in hand puts that run back before it is answered,
  // so no gesture can leave cards stranded outside every pile.
  if (sim.drag !== null) returnHeldRun(sim);
  sim.pointer = { x, y, down: true };
  // A finger never hovers, so the LANDING is what selects it; a mouse pressed
  // inside a region has moved onto it already, and selecting again changes
  // nothing (specs/controls.md).
  selectItemUnder(sim, x, y);

  if (sim.screen === "won") {
    newGame(sim);
    sim.lastPress = { x, y, at: sim.simTime };
    return;
  }

  if (sim.screen === "playing") {
    const playable = playableAt(sim, x, y);
    if (playable !== null && pairsWithLastPress(sim, x, y)) {
      // A double click lifts nothing: the card goes home if a foundation takes
      // it, and the release that follows changes nothing.
      autoMoveFrom(sim, playable.pile, playable.index);
      sim.lastPress = { x, y, at: sim.simTime };
      return;
    }
    grabAt(sim, x, y);
  }

  sim.lastPress = { x, y, at: sim.simTime };
}

/** A move to a logical stage point. */
export function moveTo(sim: Sim, x: number, y: number): void {
  const dx = x - sim.pointer.x;
  const dy = y - sim.pointer.y;
  sim.pointer = { x, y, down: sim.pointer.down };
  // "A mouse moves onto an item's region, its button up or down" and "a finger
  // ... travels onto one while down" are the same sample here, and both select
  // (specs/controls.md).
  selectItemUnder(sim, x, y);
  if (sim.drag === null) return;
  // The run keeps the offset it was lifted with, so it travels exactly as far as
  // the pointer does.
  sim.drag.x += dx;
  sim.drag.y += dy;
  refreshDropTarget(sim);
}

/** A release at a logical stage point. */
export function releaseAt(sim: Sim, x: number, y: number): void {
  moveTo(sim, x, y);
  sim.pointer = { x, y, down: false };

  const press = sim.lastPress;
  if (press === null) {
    if (sim.drag !== null) returnHeldRun(sim);
    return;
  }

  // The menu first, and whatever KIND of gesture this was: specs/controls.md has
  // either kind activate a control "when one control's hit region holds both the
  // press point and the release point".
  const pressed = menuItemAt(sim.screen, press.x, press.y);
  if (pressed !== null && pressed === menuItemAt(sim.screen, x, y)) {
    if (sim.drag !== null) returnHeldRun(sim);
    sim.menuIndex = pressed;
    activateMenuItem(sim);
    return;
  }

  const click = Math.hypot(x - press.x, y - press.y) <= DRAG_THRESHOLD;
  if (!click) {
    resolveDrop(sim);
    return;
  }

  if (sim.drag !== null) returnHeldRun(sim);
  if (
    sim.screen === "playing" &&
    rectContains(dropRect(sim, "stock", 0), press.x, press.y)
  ) {
    turnStock(sim);
  }
}
