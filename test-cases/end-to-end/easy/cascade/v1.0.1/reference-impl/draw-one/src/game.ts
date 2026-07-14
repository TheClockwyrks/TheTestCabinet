// Cascade — the game: state machine, the full Klondike rules engine (deal, legal
// moves, foundations, tableau, stock/waste, win detection), drag-and-drop, the
// double-click auto-move, and orchestration of the victory cascade.
//
// All positions are in the fixed 1280x720 logical space; the renderer scales it.

import {
  CARD_H,
  CARD_W,
  COLS_X,
  FIELD_H,
  FIELD_W,
  FIXED_STEP,
  TURN_COUNT,
} from "./constants";
import { CascadeSim } from "./cascade";
import { makeDeck, shuffle } from "./deck";
import { drawCard } from "./cards";
import {
  columnCardYs,
  foundationRect,
  hudLayout,
  intersectArea,
  pointInRect,
  stockRect,
  tableauDropRect,
  titleMenu,
  wasteFanCount,
  wasteTopRect,
} from "./layout";
import type {
  Card,
  DragSource,
  DropTarget,
  Rect,
  Screen,
} from "./types";
import { cardColor } from "./types";

interface DragState {
  cards: Card[]; // the run in hand (top card first)
  source: DragSource;
  grabDX: number; // cursor offset from the top card's origin
  grabDY: number;
  x: number; // current top-card position
  y: number;
}

// A press that may become a drag once the cursor moves past the threshold.
interface Pending {
  source: DragSource;
  cards: Card[];
  grabDX: number;
  grabDY: number;
  startX: number;
  startY: number;
}

export class Game {
  screen: Screen = "title";
  menuIndex = 0; // highlighted title-menu item

  // The thirteen piles.
  stock: Card[] = [];
  waste: Card[] = [];
  foundations: Card[][] = [[], [], [], []];
  tableau: Card[][] = [[], [], [], [], [], [], []];

  // Interaction state.
  pending: Pending | null = null;
  drag: DragState | null = null;
  dropHighlight: Rect | null = null;

  // Victory cascade.
  cascade: CascadeSim | null = null;
  private trail: HTMLCanvasElement;
  private trailCtx: CanvasRenderingContext2D;
  private cascadeAccum = 0;

  constructor() {
    this.trail = document.createElement("canvas");
    this.trail.width = FIELD_W;
    this.trail.height = FIELD_H;
    const tctx = this.trail.getContext("2d");
    if (!tctx) throw new Error("Cascade: trail canvas context unavailable");
    this.trailCtx = tctx;
  }

  get trailCanvas(): HTMLCanvasElement {
    return this.trail;
  }

  // ---- Deal ------------------------------------------------------------

  newGame(): void {
    const deck = shuffle(makeDeck());
    this.stock = [];
    this.waste = [];
    this.foundations = [[], [], [], []];
    this.tableau = [[], [], [], [], [], [], []];
    this.pending = null;
    this.drag = null;
    this.dropHighlight = null;
    this.cascade = null;

    let d = 0;
    // Column n receives n cards; every card is face-down except the last.
    for (let col = 0; col < 7; col++) {
      for (let i = 0; i <= col; i++) {
        const card = deck[d++];
        card.faceUp = i === col;
        this.tableau[col].push(card);
      }
    }
    // The remaining 24 cards form the face-down stock.
    for (; d < deck.length; d++) {
      deck[d].faceUp = false;
      this.stock.push(deck[d]);
    }
    this.screen = "playing";
  }

  // ---- Rules: acceptance checks ----------------------------------------

  private foundationAccepts(index: number, card: Card): boolean {
    const f = this.foundations[index];
    if (f.length === 0) return card.rank === 1; // only an Ace starts a foundation
    const top = f[f.length - 1];
    return top.suit === card.suit && card.rank === top.rank + 1;
  }

  private tableauAccepts(col: number, card: Card): boolean {
    const c = this.tableau[col];
    if (c.length === 0) return card.rank === 13; // only a King to an empty column
    const bottom = c[c.length - 1];
    if (!bottom.faceUp) return false;
    return cardColor(bottom) !== cardColor(card) && bottom.rank === card.rank + 1;
  }

  // The first foundation that would legally accept this card, or -1.
  private foundationFor(card: Card): number {
    for (let i = 0; i < 4; i++) {
      if (this.foundationAccepts(i, card)) return i;
    }
    return -1;
  }

  // ---- Stock / waste ---------------------------------------------------

  private turnStock(): void {
    if (this.stock.length > 0) {
      const n = Math.min(TURN_COUNT, this.stock.length);
      for (let i = 0; i < n; i++) {
        const card = this.stock.pop()!;
        card.faceUp = true;
        this.waste.push(card);
      }
    } else if (this.waste.length > 0) {
      // Recycle the whole waste back to the stock, face-down, preserving order
      // for another pass (no pass limit).
      while (this.waste.length > 0) {
        const card = this.waste.pop()!;
        card.faceUp = false;
        this.stock.push(card);
      }
    }
  }

  // ---- Post-move bookkeeping -------------------------------------------

  // Turn any column whose new bottom card is face-down, then check for a win.
  private afterMove(): void {
    for (const col of this.tableau) {
      const bottom = col[col.length - 1];
      if (bottom && !bottom.faceUp) bottom.faceUp = true;
    }
    if (this.isWin()) this.startCascade();
  }

  private isWin(): boolean {
    return this.foundations.every((f) => f.length === 13);
  }

  // ---- Victory cascade -------------------------------------------------

  private startCascade(): void {
    this.screen = "won";
    this.drag = null;
    this.pending = null;
    this.dropHighlight = null;
    this.cascadeAccum = 0;
    // Clear the persistent trail layer.
    this.trailCtx.clearRect(0, 0, FIELD_W, FIELD_H);
    this.cascade = new CascadeSim(this.foundations, (card, x, y) => {
      drawCard(this.trailCtx, card, x, y, { shadow: "trail" });
    });
  }

  // Advance the cascade on a fixed timestep, decoupled from the render rate.
  updateCascade(dt: number): void {
    if (this.screen !== "won" || !this.cascade) return;
    let acc = this.cascadeAccum + Math.min(dt, 0.25);
    while (acc >= FIXED_STEP) {
      this.cascade.step(FIXED_STEP);
      acc -= FIXED_STEP;
    }
    this.cascadeAccum = acc;
  }

  get cascadeDone(): boolean {
    return !!this.cascade && this.cascade.done;
  }

  // ---- Auto-move (double-click) ----------------------------------------

  // Double-clicking a playable card (waste top or a column's bottom face-up card)
  // sends it to its foundation when legal; otherwise does nothing.
  autoMoveToFoundation(source: DragSource): boolean {
    let card: Card | undefined;
    if (source.kind === "waste") {
      card = this.waste[this.waste.length - 1];
    } else if (source.kind === "tableau") {
      const col = this.tableau[source.col];
      card = col[col.length - 1];
      if (card && !card.faceUp) return false;
    } else {
      return false; // a card already home is not auto-moved
    }
    if (!card) return false;
    const idx = this.foundationFor(card);
    if (idx < 0) return false;
    if (source.kind === "waste") this.waste.pop();
    else if (source.kind === "tableau") this.tableau[source.col].pop();
    this.foundations[idx].push(card);
    this.afterMove();
    return true;
  }

  // ---- Pointer input (routed from input.ts) ----------------------------

  // Returns true if the press was consumed (a control/stock click), so the caller
  // knows no drag is pending.
  pressAt(x: number, y: number): void {
    if (this.screen === "title") {
      this.pressTitle(x, y);
      return;
    }
    if (this.screen === "howto") {
      this.screen = "title";
      return;
    }
    if (this.screen === "won") {
      // Any press during / after the cascade starts a fresh game.
      this.newGame();
      return;
    }
    // screen === "playing"
    const hud = hudLayout();
    if (pointInRect(x, y, hud.newGame)) {
      this.newGame();
      return;
    }
    if (pointInRect(x, y, hud.menu)) {
      this.screen = "title";
      return;
    }
    // Stock: turn or recycle (never draggable).
    if (pointInRect(x, y, stockRect())) {
      this.turnStock();
      return;
    }
    // Waste top card → pending single-card drag.
    if (this.waste.length > 0) {
      const r = wasteTopRect(this.waste.length);
      if (pointInRect(x, y, r)) {
        const card = this.waste[this.waste.length - 1];
        this.pending = {
          source: { kind: "waste" },
          cards: [card],
          grabDX: x - r.x,
          grabDY: y - r.y,
          startX: x,
          startY: y,
        };
        return;
      }
    }
    // Foundation top card → pending single-card pullback (foundation → tableau).
    for (let i = 0; i < 4; i++) {
      const f = this.foundations[i];
      if (f.length === 0) continue;
      const r = foundationRect(i);
      if (pointInRect(x, y, r)) {
        const card = f[f.length - 1];
        this.pending = {
          source: { kind: "foundation", index: i },
          cards: [card],
          grabDX: x - r.x,
          grabDY: y - r.y,
          startX: x,
          startY: y,
        };
        return;
      }
    }
    // Tableau: grab the front-most face-up card under the cursor and the run below.
    for (let col = 0; col < 7; col++) {
      const cards = this.tableau[col];
      if (cards.length === 0) continue;
      const ys = columnCardYs(cards);
      // The card that owns the point is the highest-index one containing it.
      for (let i = cards.length - 1; i >= 0; i--) {
        const cx = COLS_X[col];
        const cy = ys[i];
        if (x >= cx && x < cx + CARD_W && y >= cy && y < cy + CARD_H) {
          const card = cards[i];
          if (!card.faceUp) return; // face-down cards are never draggable
          this.pending = {
            source: { kind: "tableau", col },
            cards: cards.slice(i),
            grabDX: x - cx,
            grabDY: y - cy,
            startX: x,
            startY: y,
          };
          return;
        }
      }
    }
  }

  private pressTitle(x: number, y: number): void {
    const menu = titleMenu();
    for (let i = 0; i < menu.length; i++) {
      if (pointInRect(x, y, menu[i].rect)) {
        this.menuIndex = i;
        this.activateMenu();
        return;
      }
    }
  }

  activateMenu(): void {
    if (this.menuIndex === 0) this.newGame();
    else this.screen = "howto";
  }

  moveTo(x: number, y: number): void {
    if (this.screen === "title") {
      // Hover highlights the item under the cursor.
      const menu = titleMenu();
      for (let i = 0; i < menu.length; i++) {
        if (pointInRect(x, y, menu[i].rect)) this.menuIndex = i;
      }
      return;
    }
    if (this.drag) {
      this.drag.x = x - this.drag.grabDX;
      this.drag.y = y - this.drag.grabDY;
      this.updateDropHighlight();
      return;
    }
    if (this.pending) {
      const dx = x - this.pending.startX;
      const dy = y - this.pending.startY;
      if (dx * dx + dy * dy >= 25 /* DRAG_THRESHOLD^2 */) {
        this.beginDrag(x, y);
      }
    }
  }

  private beginDrag(x: number, y: number): void {
    const p = this.pending!;
    // Detach the cards from their source pile.
    if (p.source.kind === "waste") {
      this.waste.pop();
    } else if (p.source.kind === "foundation") {
      this.foundations[p.source.index].pop();
    } else {
      const col = this.tableau[p.source.col];
      col.splice(col.length - p.cards.length, p.cards.length);
    }
    this.drag = {
      cards: p.cards,
      source: p.source,
      grabDX: p.grabDX,
      grabDY: p.grabDY,
      x: x - p.grabDX,
      y: y - p.grabDY,
    };
    this.pending = null;
    this.updateDropHighlight();
  }

  // The best legal drop target under the dragged run's top card, if any.
  private bestTarget(): DropTarget | null {
    if (!this.drag) return null;
    const top = this.drag.cards[0];
    const handRect: Rect = { x: this.drag.x, y: this.drag.y, w: CARD_W, h: CARD_H };
    let best: DropTarget | null = null;
    let bestArea = 0;

    // Foundations accept a single card only.
    if (this.drag.cards.length === 1) {
      for (let i = 0; i < 4; i++) {
        if (!this.foundationAccepts(i, top)) continue;
        const area = intersectArea(handRect, foundationRect(i));
        if (area > bestArea) {
          bestArea = area;
          best = { kind: "foundation", index: i };
        }
      }
    }
    // Tableau columns accept a single card or a valid run.
    for (let col = 0; col < 7; col++) {
      if (!this.tableauAccepts(col, top)) continue;
      const area = intersectArea(handRect, tableauDropRect(col, this.tableau[col]));
      if (area > bestArea) {
        bestArea = area;
        best = { kind: "tableau", col };
      }
    }
    return bestArea > 0 ? best : null;
  }

  private updateDropHighlight(): void {
    const t = this.bestTarget();
    if (!t) {
      this.dropHighlight = null;
    } else if (t.kind === "foundation") {
      this.dropHighlight = foundationRect(t.index);
    } else {
      this.dropHighlight = tableauDropRect(t.col, this.tableau[t.col]);
    }
  }

  releaseAt(_x: number, _y: number): void {
    if (this.drag) {
      const target = this.bestTarget();
      if (target) this.applyDrop(target);
      else this.returnToSource();
      this.drag = null;
      this.dropHighlight = null;
    }
    this.pending = null;
  }

  private applyDrop(target: DropTarget): void {
    const cards = this.drag!.cards;
    if (target.kind === "foundation") {
      this.foundations[target.index].push(cards[0]);
    } else {
      this.tableau[target.col].push(...cards);
    }
    this.afterMove();
  }

  private returnToSource(): void {
    const d = this.drag!;
    if (d.source.kind === "waste") {
      this.waste.push(...d.cards);
    } else if (d.source.kind === "foundation") {
      this.foundations[d.source.index].push(...d.cards);
    } else {
      this.tableau[d.source.col].push(...d.cards);
    }
  }

  // ---- Double click ----------------------------------------------------

  doubleClickAt(x: number, y: number): void {
    if (this.screen !== "playing") return;
    // Cancel any half-formed drag from the click that preceded the dblclick.
    if (this.drag) {
      this.returnToSource();
      this.drag = null;
      this.dropHighlight = null;
    }
    this.pending = null;

    // Waste top card.
    if (this.waste.length > 0 && pointInRect(x, y, wasteTopRect(this.waste.length))) {
      this.autoMoveToFoundation({ kind: "waste" });
      return;
    }
    // A column's bottom face-up card.
    for (let col = 0; col < 7; col++) {
      const cards = this.tableau[col];
      if (cards.length === 0) continue;
      const ys = columnCardYs(cards);
      const last = cards.length - 1;
      const cx = COLS_X[col];
      const cy = ys[last];
      if (x >= cx && x < cx + CARD_W && y >= cy && y < cy + CARD_H) {
        this.autoMoveToFoundation({ kind: "tableau", col });
        return;
      }
    }
  }

  // Render-facing helpers.
  get wasteVisibleCount(): number {
    return wasteFanCount(this.waste.length);
  }
}
