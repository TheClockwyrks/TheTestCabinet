// The test harness the build's own suite stands the game up with.
//
// A harness builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`. The
// pointer is driven either by dispatching pointer-shaped events at the surface's
// event target — the same listeners a player's pointer reaches — or through the
// debug surface's own pointer operations, and what is read back is the world's
// `CascadeState`, the surface `initialize` returned, the engine's cue events, and
// the pixels the render produced.
//
// The surface reports the canvas at the design size with a device pixel ratio of
// 1 and no origin, so a dispatched event's client position IS a logical stage
// position, the camera at rest maps world onto logical one to one, and a pixel
// read needs no conversion either.
//
// A Node process carries neither `OffscreenCanvas` nor a document, and the
// painted layer needs one of the two, so `./canvas-shim` stands both up over
// `@napi-rs/canvas`. It is imported first, so the shim is in place before a frame
// can ask for a surface.

import "./canvas-shim";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/structured-2d";

import {
  CARD_H,
  CARD_W,
  DECK_SIZE,
  RANK_MAX,
  RANK_MIN,
  STAGE_H,
  STAGE_W,
  SUITS,
} from "./constants";
import {
  cascadeState,
  BACKGROUND,
  game,
  type CascadeDebugApi,
  type CascadeState,
  type PileKind,
  type Suit,
} from "./game";
import { columnCardYs, pileAnchor } from "./layout";

/** One frame of the scripted clock: a sixtieth of a second. */
export const FRAME_MS = 1000 / 60;

/** A pointer-shaped event, read by the engine's own pointer listeners. */
export class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

/** A keyboard-shaped event, read by the engine's own key listeners. */
export class KeyEvt extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

export interface CuePlay {
  cue: string;
  gain: number;
}

/** One card as a scenario names it: a suit, a rank, and which way up it lies. */
export interface PosedCard {
  suit: Suit;
  rank: number;
  faceUp?: boolean;
}

export interface Harness {
  readonly engine: Engine<CascadeDebugApi>;
  /** The world's live game state. */
  readonly state: CascadeState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: CascadeDebugApi;
  readonly ctx: SKRSContext2D;
  /** Every `cue:played` the engine emitted, in order. */
  readonly cues: CuePlay[];
  /** Drive the REAL pointer, as a player's mouse or finger drives it. */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  /** Tap a key at the engine's own listeners. */
  tap(code: string): void;
  advance(frames: number): Promise<void>;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

export async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options src/main.ts passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    clock: new ConstantClock(FRAME_MS),
    surface,
  });

  const cues: CuePlay[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));

  await engine.initialize();

  return {
    engine,
    get state() {
      return cascadeState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface from `initialize` fails here.
    debug: engine.debug,
    ctx,
    cues,
    pointer: (type, x, y) => {
      events.dispatchEvent(new PointerEvt(type, x, y));
    },
    tap: (code) => {
      events.dispatchEvent(new KeyEvt("keydown", code));
      events.dispatchEvent(new KeyEvt("keyup", code));
    },
    advance: (frames) => engine.advance(frames),
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
}

// ---- Posing a table -------------------------------------------------------

/**
 * An isolated table: every field back at its title-screen value, the game on
 * `playing`, and not one card anywhere. Cascade has no autonomous entity, so an
 * empty table is already a world that changes only when a scenario changes it,
 * and all four gates are left ON at their reset defaults.
 */
export function openTable(h: Harness): void {
  h.debug.reset();
  h.debug.setScreen("playing");
  h.debug.clearTable();
}

/** One column, bottom card first. Returns the ids in the same order. */
export function poseColumn(
  h: Harness,
  column: number,
  cards: readonly PosedCard[],
): number[] {
  for (const card of cards) {
    h.debug.addCard(
      "tableau",
      column,
      card.suit,
      card.rank,
      card.faceUp ?? true,
    );
  }
  return h.debug.snapshot().tableau[column].map((card) => card.id);
}

/** One foundation, its Ace through the rank named. */
export function poseFoundation(
  h: Harness,
  index: number,
  suit: Suit,
  upTo: number,
): number[] {
  for (let rank = RANK_MIN; rank <= upTo; rank += 1) {
    h.debug.addCard("foundation", index, suit, rank, true);
  }
  return h.debug.snapshot().foundations[index].map((card) => card.id);
}

/**
 * The waste, bottom card first, and the sets its memory holds, oldest first. The
 * sets are never omitted and never sum to more cards than were given, so no pose
 * leaves a waste holding cards it shows none of unless it meant to.
 */
export function poseWaste(
  h: Harness,
  cards: readonly PosedCard[],
  sets: readonly number[],
): number[] {
  for (const card of cards) {
    h.debug.addCard("waste", 0, card.suit, card.rank, card.faceUp ?? true);
  }
  for (const count of sets) h.debug.addWasteSet(count);
  return h.debug.snapshot().waste.map((card) => card.id);
}

/** The stock, bottom card first, so the LAST card given is the next one turned. */
export function poseStock(h: Harness, cards: readonly PosedCard[]): number[] {
  for (const card of cards) {
    h.debug.addCard("stock", 0, card.suit, card.rank, card.faceUp ?? false);
  }
  return h.debug.snapshot().stock.map((card) => card.id);
}

/**
 * Every foundation complete but for one suit's King, which is put on column `0`
 * face-up so a move or a gesture can carry it home. A foundation is a stack, so
 * the one card left out is always a King: any other hole would need cards above
 * it that no foundation could hold.
 */
export function poseNearlyWon(h: Harness, suit: Suit): void {
  SUITS.forEach((each, index) => {
    poseFoundation(h, index, each, each === suit ? RANK_MAX - 1 : RANK_MAX);
  });
  h.debug.addCard("tableau", 0, suit, RANK_MAX, true);
}

/** Enter the cascade through the game's own win path. */
export function startCascade(h: Harness, suit: Suit = "spades"): boolean {
  poseNearlyWon(h, suit);
  const column = h.debug.snapshot().tableau[0];
  return h.debug.move(
    "tableau",
    0,
    column.length - 1,
    "foundation",
    SUITS.indexOf(suit),
  );
}

// ---- Gestures -------------------------------------------------------------

/** The anchor of a pile, as the geometry fixes it. */
export function pileTopLeft(
  pile: PileKind,
  index: number,
): { x: number; y: number } {
  const at = pileAnchor(pile, index);
  if (at === null) throw new Error(`Cascade: no pile ${pile}/${index}`);
  return at;
}

/** The top-left of a card in a column, from the offsets and the compression rule. */
export function columnCardTopLeft(
  h: Harness,
  column: number,
  row: number,
): { x: number; y: number } {
  const cards = h.state.tableau[column];
  const ys = columnCardYs(cards);
  return { x: pileTopLeft("tableau", column).x, y: ys[row] };
}

/** The centre of a card whose top-left is `(x, y)`. */
export function centreOf(x: number, y: number): { x: number; y: number } {
  return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
}

/** A press, a sweep and a release, driven through the debug surface's pointer. */
export function drag(
  h: Harness,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  steps = 4,
): void {
  h.debug.pointerDown(x0, y0);
  for (let i = 1; i <= steps; i += 1) {
    h.debug.pointerMove(
      x0 + ((x1 - x0) * i) / steps,
      y0 + ((y1 - y0) * i) / steps,
    );
  }
  h.debug.pointerUp(x1, y1);
}

/** A press and a release at one point, which is a CLICK rather than a drop. */
export function clickAt(h: Harness, x: number, y: number): void {
  h.debug.pointerDown(x, y);
  h.debug.pointerUp(x, y);
}

/** Two clicks with no game time between them, so the presses are `0` s apart. */
export function doubleClickAt(h: Harness, x: number, y: number): void {
  clickAt(h, x, y);
  clickAt(h, x, y);
}

/** How far apart two colours read, as a Euclidean RGB distance out of 441. */
export function colorDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export { CARD_H, CARD_W, DECK_SIZE, STAGE_H, STAGE_W };
