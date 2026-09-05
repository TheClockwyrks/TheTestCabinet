// The test harness the build's own suite stands the game up with.
//
// A harness builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`. The
// pointer is driven two ways: by dispatching pointer-shaped events at the
// surface's event target, which is the path a player's pointer takes and which
// arrives at the game as the frame's ordered samples, and through the debug
// surface's own pointer operations, which take effect at the call. What is read
// back is the world's own `CascadeState`, the debug surface `initialize`
// returned, the engine's cue events, and the pixels the render produced.
//
// The surface reports the canvas at the design size with a device pixel ratio of
// 1 and no origin, so a dispatched event's client position IS a logical stage
// position, the camera at rest maps world onto logical one to one, and a pixel
// read needs no conversion either.
//
// Node has neither an `OffscreenCanvas` nor a `document`, so the painted layer —
// the one drawing resource the game holds (specs/victory.md) — would be absent
// here. The shim below gives the host both, backed by `@napi-rs/canvas`, and
// only where the host has none, so it never displaces a real browser.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/structured-2d";
import { STAGE_H, STAGE_W, TABLEAU_COLUMNS } from "./constants";
import {
  BACKGROUND,
  cascadeState,
  game,
  type CascadeDebugApi,
  type CascadeState,
  type Suit,
} from "./game";

if (!("OffscreenCanvas" in globalThis)) {
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: class {
      constructor(width: number, height: number) {
        return createCanvas(width, height) as unknown as object;
      }
    },
    configurable: true,
  });
}
if (!("document" in globalThis)) {
  Object.defineProperty(globalThis, "document", {
    value: {
      createElement(tag: string) {
        if (tag !== "canvas") throw new Error(`no element ${tag}`);
        return createCanvas(1, 1);
      },
    },
    configurable: true,
  });
}

/** One advanced frame is one sixtieth of a second of game time. */
export const FRAME_DT = 1 / 60;
export const FRAME_MS = FRAME_DT * 1000;

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

export interface CuePlay {
  cue: string;
  gain: number;
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
  /** Dispatch one pointer-shaped event at the surface, as a player's pointer does. */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  /** Run `frames` whole frames of `FRAME_DT` each. */
  advance(frames: number): Promise<void>;
  /** Run whole frames covering about `seconds` of game time, at `step` seconds each. */
  seconds(seconds: number, step?: number): Promise<void>;
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

  const advance = (frames: number): Promise<void> => engine.advance(frames);

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
    advance,
    seconds: async (seconds, step = FRAME_DT) => {
      const frames = Math.max(1, Math.round(seconds / step));
      if (step === FRAME_DT) {
        await advance(frames);
        return;
      }
      engine.setClock(new ConstantClock(step * 1000));
      await advance(frames);
      engine.setClock(new ConstantClock(FRAME_MS));
    },
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
}

// ---- The scenarios the suite poses --------------------------------------

/**
 * Live play on an empty table, which in Cascade is already an isolated world:
 * nothing here arrives uninvited, so the four faculty gates are left ON at
 * their reset defaults and a scenario turns one off only when that gate is its
 * own subject.
 */
export function openTable(debug: CascadeDebugApi): void {
  debug.reset();
  debug.setScreen("playing");
  debug.clearTable();
}

/** A card named the way a scenario names one. */
export interface Spec {
  suit: Suit;
  rank: number;
  faceUp?: boolean;
}

/** Pose one column, bottom card first, and return the ids in the same order. */
export function poseColumn(
  debug: CascadeDebugApi,
  column: number,
  cards: readonly Spec[],
): number[] {
  for (const card of cards) {
    debug.addCard("tableau", column, card.suit, card.rank, card.faceUp ?? true);
  }
  return debug
    .snapshot()
    .tableau[column].slice(-cards.length)
    .map((card) => card.id);
}

/** Pose one foundation with its Ace through `upTo`, all face-up. */
export function poseFoundation(
  debug: CascadeDebugApi,
  index: number,
  suit: Suit,
  upTo: number,
): void {
  for (let rank = 1; rank <= upTo; rank += 1) {
    debug.addCard("foundation", index, suit, rank, true);
  }
}

/**
 * Pose the waste: its cards bottom-first, then its sets oldest-first. The sets
 * are never omitted and never sum to more cards than were given, so no pose
 * leaves a waste holding cards it shows none of by accident.
 */
export function poseWaste(
  debug: CascadeDebugApi,
  cards: readonly Spec[],
  sets: readonly number[],
): void {
  for (const card of cards) {
    debug.addCard("waste", 0, card.suit, card.rank, card.faceUp ?? true);
  }
  const total = sets.reduce((sum, count) => sum + count, 0);
  if (total > cards.length) {
    throw new Error(`poseWaste: ${total} cards in sets over ${cards.length}`);
  }
  for (const count of sets) debug.addWasteSet(count);
}

/** Pose the stock, bottom card first, so the LAST card given is the next turned. */
export function poseStock(
  debug: CascadeDebugApi,
  cards: readonly Spec[],
): void {
  for (const card of cards) {
    debug.addCard("stock", 0, card.suit, card.rank, card.faceUp ?? false);
  }
}

/**
 * Every foundation but one complete, Ace to King, and the last one held at its
 * Queen with its King posed on column `0` instead. Returns where that King
 * sits, one move from winning the game.
 */
export function poseNearlyWon(
  debug: CascadeDebugApi,
  suit: Suit = "clubs",
): { column: number; row: number } {
  const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  suits.forEach((each, index) => {
    poseFoundation(debug, index, each, each === suit ? 12 : 13);
  });
  debug.addCard("tableau", 0, suit, 13, true);
  const column = 0;
  const row = debug.snapshot().tableau[column].length - 1;
  return { column, row };
}

/** Every column of the table, as the snapshot reports them. */
export const COLUMNS = Array.from({ length: TABLEAU_COLUMNS }, (_, i) => i);
