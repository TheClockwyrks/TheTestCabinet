// Cascade — the pointer, and every control it answers.
//
// specs/controls.md fixes all of this: what a press picks up, that the run enters
// the hand ON THE PRESS ITSELF before any motion, what separates a click from a
// drop, where a drop lands, the double click, and the six control rectangles.
//
// EVERY SAMPLE IS RESOLVED THE MOMENT IT ARRIVES. There is no per-frame queue and
// no "last position of the frame": the runtime hands each sample straight here, so
// a press and the release that followed it inside one frame both take effect, and
// a posed press and a player's press are the same event to the game
// (specs/instrumentation.md).
//
// A drop resolves against the CENTER OF THE RUN'S LEADING CARD, not against the
// pointer, because the pointer may sit anywhere on the card it grabbed.

import {
  CARD_H,
  CARD_W,
  CUES,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  HOWTO_BACK,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
  TOP_ROW_Y,
  FOUNDATION_X,
  COLUMN_X,
} from "./constants";
import { raiseCue } from "./audio";
import {
  asTarget,
  cardAtPoint,
  columnCardTops,
  contains,
  dropRect,
  pileAtPoint,
  wasteFanX,
  type CardHit,
} from "./layout";
import {
  autoMove,
  deal,
  landRun,
  liftRun,
  playableCard,
  returnRun,
  targetAccepts,
  turnStock,
  type RunSource,
} from "./moves";
import type { PointerSample } from "./pointer";
import type { CascadeState, SourceKind } from "./state";
import { wasteShownCount } from "./waste";

/** What the pointer path needs of the runtime: the mute bit, and nothing else. */
export interface InputAudio {
  setMuted(muted: boolean): void;
  muted(): boolean;
}

/** The distance between two points. */
function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Where a card is currently drawn, which is where a run lifted from it starts.
 *
 * Read BEFORE the lift: taking cards off a column changes its compression, so the
 * position has to be the one the player actually pressed on.
 */
function drawnTopLeft(
  state: CascadeState,
  hit: CardHit,
): { x: number; y: number } | null {
  if (hit.kind === "tableau") {
    const column = state.tableau[hit.index];
    if (column === undefined) return null;
    const tops = columnCardTops(column);
    return { x: COLUMN_X[hit.index], y: tops[hit.row] };
  }
  if (hit.kind === "foundation") {
    return { x: FOUNDATION_X[hit.index], y: TOP_ROW_Y };
  }
  if (hit.kind === "waste") {
    const shown = wasteShownCount(state);
    const buried = state.waste.length - shown;
    const fan = hit.row - buried;
    return { x: fan >= 0 ? wasteFanX(fan) : wasteFanX(0), y: TOP_ROW_Y };
  }
  return null;
}

/** Whether a hit landed on a pile's playable card, which a double click needs. */
function isPlayableHit(state: CascadeState, hit: CardHit): boolean {
  const playable = playableCard(state, hit.kind, hit.index);
  return playable !== null && playable.row === hit.row;
}

/** Put any run in hand back where it came from, silently. */
function releaseToSource(state: CascadeState): void {
  const drag = state.drag;
  if (drag === null) return;
  returnRun(state, drag.cards, {
    pile: drag.fromPile,
    index: drag.fromIndex,
  });
  state.drag = null;
  state.dropTarget = null;
}

/**
 * Recompute the pile a release would land the held run on.
 *
 * A pile is the drop target only while the release rule would resolve the run to
 * it AND that pile accepts it, so an illegal pile under the run highlights
 * nothing.
 */
export function refreshDropTarget(state: CascadeState): void {
  const drag = state.drag;
  if (drag === null) {
    state.dropTarget = null;
    return;
  }
  const pile = pileAtPoint(state, drag.x + CARD_W / 2, drag.y + CARD_H / 2);
  const target = pile === null ? null : asTarget(pile.kind, pile.index);
  state.dropTarget =
    target !== null && targetAccepts(state, drag.cards, target) ? target : null;
}

/** Deal a fresh game and put the player on the table. */
function dealAndPlay(state: CascadeState): void {
  deal(state);
  state.screen = "playing";
}

/**
 * Activate the control whose rectangle contains a point, and report whether one
 * did. A control answers only on the screen it belongs to.
 */
export function activateControl(
  state: CascadeState,
  audio: InputAudio,
  x: number,
  y: number,
): boolean {
  if (state.screen === "title") {
    if (contains(TITLE_NEW_GAME, x, y)) {
      dealAndPlay(state);
      return true;
    }
    if (contains(TITLE_HOW_TO, x, y)) {
      state.screen = "howto";
      return true;
    }
    return false;
  }
  if (state.screen === "howto") {
    if (contains(HOWTO_BACK, x, y)) {
      state.screen = "title";
      return true;
    }
    return false;
  }
  if (state.screen === "playing") {
    if (contains(HUD_NEW_GAME, x, y)) {
      deal(state);
      return true;
    }
    if (contains(HUD_MENU, x, y)) {
      state.screen = "title";
      return true;
    }
    if (contains(HUD_SOUND, x, y)) {
      const next = !audio.muted();
      audio.setMuted(next);
      state.muted = next;
      return true;
    }
    return false;
  }
  return false;
}

/** A press: the whole of what a press does, on whichever screen it lands. */
function press(state: CascadeState, x: number, y: number): void {
  const previous = state.lastPress;
  state.lastPress = { x, y, at: state.simTime };
  state.gestureSpent = false;
  // A stray press while something is in hand is not a second gesture; the run
  // goes back and the new press starts clean.
  releaseToSource(state);

  if (state.screen === "won") {
    dealAndPlay(state);
    state.gestureSpent = true;
    return;
  }
  if (state.screen !== "playing") return;

  const hit = cardAtPoint(state, x, y);

  if (
    previous !== null &&
    state.simTime - previous.at <= DOUBLE_CLICK_WINDOW &&
    distance(x, y, previous.x, previous.y) <= DOUBLE_CLICK_SLOP &&
    hit !== null &&
    isPlayableHit(state, hit)
  ) {
    // A double click lifts nothing: the card goes home, or stays where it is,
    // and the release that follows changes nothing.
    autoMove(state, hit.kind, hit.index);
    state.gestureSpent = true;
    return;
  }

  if (hit === null || hit.kind === "stock") return;
  const at = drawnTopLeft(state, hit);
  if (at === null) return;
  const from: RunSource = { pile: hit.kind as SourceKind, index: hit.index };
  const cards = liftRun(state, from, hit.row);
  if (cards === null) return;

  state.drag = {
    cards,
    fromPile: from.pile,
    fromIndex: from.index,
    x: at.x,
    y: at.y,
    grabDx: x - at.x,
    grabDy: y - at.y,
  };
  raiseCue(state, CUES.lift);
  refreshDropTarget(state);
}

/** The held run follows the pointer, keeping the offset the press gave it. */
function travel(state: CascadeState, x: number, y: number): void {
  const drag = state.drag;
  if (drag === null) return;
  drag.x = x - drag.grabDx;
  drag.y = y - drag.grabDy;
  refreshDropTarget(state);
}

/** Resolve a drop against the drop rectangles, and land it or return it. */
function resolveDrop(state: CascadeState): void {
  const drag = state.drag;
  if (drag === null) return;
  const from: RunSource = { pile: drag.fromPile, index: drag.fromIndex };
  const cards = drag.cards;
  state.drag = null;
  state.dropTarget = null;

  const pile = pileAtPoint(state, drag.x + CARD_W / 2, drag.y + CARD_H / 2);
  const target = pile === null ? null : asTarget(pile.kind, pile.index);
  if (target !== null && landRun(state, cards, from, target)) {
    raiseCue(state, CUES.drop);
    return;
  }
  returnRun(state, cards, from);
  raiseCue(state, CUES.reject);
}

/** A release: a click or a drop, as the distance from its press decides. */
function release(
  state: CascadeState,
  audio: InputAudio,
  x: number,
  y: number,
): void {
  travel(state, x, y);

  if (state.gestureSpent) {
    state.gestureSpent = false;
    releaseToSource(state);
    return;
  }

  const from = state.lastPress;
  const click =
    from === null || distance(x, y, from.x, from.y) <= DRAG_THRESHOLD;

  if (!click) {
    resolveDrop(state);
    return;
  }

  releaseToSource(state);
  if (from === null) return;
  if (activateControl(state, audio, from.x, from.y)) return;
  if (
    state.screen === "playing" &&
    contains(dropRect(state, "stock", 0), from.x, from.y)
  ) {
    turnStock(state);
  }
}

/** Answer one pointer sample, resolved before the call returns. */
export function handlePointer(
  state: CascadeState,
  audio: InputAudio,
  sample: PointerSample,
): void {
  state.pointer.x = sample.x;
  state.pointer.y = sample.y;
  switch (sample.phase) {
    case "down":
      state.pointer.down = true;
      press(state, sample.x, sample.y);
      return;
    case "move":
      travel(state, sample.x, sample.y);
      return;
    case "up":
      state.pointer.down = false;
      release(state, audio, sample.x, sample.y);
      return;
    case "cancel":
      state.pointer.down = false;
      state.gestureSpent = false;
      releaseToSource(state);
      return;
  }
}
