// Cascade — the shapes the whole build shares.
//
// Deliberately data only: no behaviour lives here, so every other module can
// import it without pulling anything behind it.

/** The four suits (`specs/deal.md`). */
export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/** The two colours a suit is drawn in (`specs/deal.md`). */
export type CardColor = "red" | "black";

/** One playing card. `rank` runs 1 (the Ace) to 13 (the King). */
export interface Card {
  /** Distinct among the entities live at any moment, and kept across moves. */
  id: number;
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

/** The four screens the game moves between (`specs/screens.md`). */
export type Screen = "title" | "howto" | "playing" | "won";

/** An axis-aligned rectangle in logical stage units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How the debug surface and the drop rules name a pile. */
export type PileName = "stock" | "waste" | "foundation" | "tableau";

/** One of the thirteen piles: a kind and its index within that kind. */
export interface PileRef {
  pile: PileName;
  index: number;
}

/** A pile a run may be lifted from. The stock is never a source. */
export type SourcePile = "waste" | "foundation" | "tableau";

/** A pile a run may land on. */
export type TargetPile = "foundation" | "tableau";

/** A card in flight during the victory cascade (`specs/victory.md`). */
export interface Flyer {
  id: number;
  suit: Suit;
  rank: number;
  /** The top-left of the card's footprint, in logical units. */
  x: number;
  y: number;
  /** Logical units per second. */
  vx: number;
  vy: number;
}

/** The run currently in hand (`specs/controls.md`). */
export interface Drag {
  /** Bottom to top, so `cards[0]` is the grabbed card and leads the run. */
  cards: Card[];
  fromPile: SourcePile;
  fromIndex: number;
  /** The top-left of `cards[0]`. */
  x: number;
  y: number;
  /** How far the press point sat inside the leading card when it was lifted. */
  grabDX: number;
  grabDY: number;
}

/** The pile a release would land the held run on. */
export interface DropTarget {
  pile: TargetPile;
  index: number;
}

/** The most recent press, which the double-click rule is measured against. */
export interface LastPress {
  x: number;
  y: number;
  /** The `simTime` the press arrived at, in seconds. */
  at: number;
}

/** The gesture a press opened, until its release closes it. */
export interface Gesture {
  x: number;
  y: number;
  /**
   * Set when the press was itself a double click. The release that follows one
   * changes nothing (`specs/controls.md`).
   */
  spent: boolean;
}

/** Which colour a suit is drawn in. */
export function suitColor(suit: Suit): CardColor {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

/** Whether a point lies inside a rectangle, half-open on the far edges. */
export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
