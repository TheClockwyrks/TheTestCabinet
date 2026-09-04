// Cascade under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`, which
// makes a duration an exact number of frames. What is read back is the game's own
// state, the debug surface the game returned beside it, the engine's cue events,
// the strings the render drew, and the pixels it produced.
//
// The state is a value the engine replaces every frame, so `h.state` reads
// `engine.state` at the moment it is read rather than holding the object
// `initialize` built. A pose takes a state and returns the next one and is driven
// through `engine.apply`; a reading is handed `engine.state`; `move` and
// `autoMove` return a pair, and the pair is split INSIDE the transition, because
// handing the tuple to `engine.apply` would store the tuple as the state.
//
// Node offers no `OffscreenCanvas`, so the painted layer gets one backed by the
// same canvas library. That is the same surface a browser gives the build, and it
// is what lets the trail's pixels be read here at all.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  CASCADE_DEBUG_VERSION,
  COLUMN_X,
  CUES,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  DECK_SIZE,
  FOUNDATION_X,
  HUD_ITEMS,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  TABLEAU_Y,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  TOP_ROW_Y,
  TURN_COUNT,
  WASTE_X,
  WASTE_FAN,
  WIN_TEXT,
} from "./constants";
import {
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
} from "./menus";
import type { Rect } from "./layout";
import {
  BACKGROUND,
  game,
  type CascadeDebugApi,
  type CascadeSnapshot,
  type CascadeState,
} from "./game";
import type { PileKind, Suit } from "./game";
import type { DeepReadonly } from "ts-essentials";

// ---- The host ------------------------------------------------------------

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

const FPS = 240;
const TICK_MS = 1000 / FPS;

class PointerEventLike extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(type: string, x: number, y: number) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

interface CuePlay {
  cue: string;
  gain: number;
}

interface DrawnText {
  text: string;
  x: number;
  y: number;
}

type Rgba = [number, number, number, number];

interface Harness {
  readonly engine: Engine<CascadeState, CascadeDebugApi>;
  readonly state: DeepReadonly<CascadeState>;
  readonly debug: CascadeDebugApi;
  pose(
    transition: (
      state: DeepReadonly<CascadeState>,
      debug: CascadeDebugApi,
    ) => CascadeState,
  ): void;
  decide(
    transition: (
      state: DeepReadonly<CascadeState>,
      debug: CascadeDebugApi,
    ) => [CascadeState, boolean],
  ): boolean;
  snapshot(): CascadeSnapshot;
  readonly cues: CuePlay[];
  readonly texts: DrawnText[];
  mouseDown(x: number, y: number): void;
  mouseMove(x: number, y: number): void;
  mouseUp(x: number, y: number): void;
  pixel(x: number, y: number): Rgba;
  frames(count: number): Promise<void>;
  advance(seconds: number): Promise<void>;
  setStep(seconds: number): void;
  dispose(): void;
}

async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");

  const texts: DrawnText[] = [];
  const drawText = ctx.fillText.bind(ctx) as (
    text: string,
    x: number,
    y: number,
  ) => void;
  ctx.fillText = ((text: string, x: number, y: number): void => {
    texts.push({ text, x, y });
    drawText(text, x, y);
  }) as SKRSContext2D["fillText"];

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

  // Exactly the options `src/main.ts` passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<CascadeState, CascadeDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    clock: new ConstantClock(TICK_MS),
    surface,
  });

  const cues: CuePlay[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));

  await engine.initialize();
  const debug = engine.debug;

  const dispatch = (type: string, x: number, y: number): void => {
    events.dispatchEvent(new PointerEventLike(type, x, y));
  };

  return {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    pose: (transition) => {
      engine.apply((s) => transition(s, debug));
    },
    decide: (transition) => {
      let verdict = false;
      engine.apply((s) => {
        const [next, decided] = transition(s, debug);
        verdict = decided;
        return next;
      });
      return verdict;
    },
    snapshot: () => debug.snapshot(engine.state),
    cues,
    texts,
    mouseDown: (x, y) => {
      dispatch("pointerdown", x, y);
    },
    mouseMove: (x, y) => {
      dispatch("pointermove", x, y);
    },
    mouseUp: (x, y) => {
      dispatch("pointerup", x, y);
    },
    pixel: (x, y) => {
      const view: Viewport = engine.viewport();
      const { data } = ctx.getImageData(
        Math.round(view.offsetX + x * view.scale),
        Math.round(view.offsetY + y * view.scale),
        1,
        1,
      );
      return [
        data[0] as number,
        data[1] as number,
        data[2] as number,
        data[3] as number,
      ];
    },
    frames: (count) => engine.advance(count),
    advance: (seconds) => engine.advance(Math.round(seconds * FPS)),
    setStep: (seconds) => {
      engine.setClock(new ConstantClock(seconds * 1000));
    },
    dispose: () => {
      engine.destroy();
    },
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

// ---- Helpers -------------------------------------------------------------

/** How far apart two colours are, of the 441 an RGB distance can reach. */
function distance(a: Rgba, b: Rgba): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** An empty table in live play, with nothing on it a check did not ask for. */
function openTable(): void {
  h.pose((s, d) => d.clearTable(s));
  h.pose((s, d) => d.clearFlyers(s));
  h.pose((s, d) => d.setScreen(s, "playing"));
}

/** Put one card on a pile and hand back the id it took. */
function addCard(
  pile: PileKind,
  index: number,
  suit: Suit,
  rank: number,
  faceUp = true,
): number {
  h.pose((s, d) => d.addCard(s, pile, index, suit, rank, faceUp));
  const snap = h.snapshot();
  const cards =
    pile === "stock"
      ? snap.stock
      : pile === "waste"
        ? snap.waste
        : pile === "foundation"
          ? (snap.foundations[index] as CascadeSnapshot["stock"])
          : (snap.tableau[index] as CascadeSnapshot["stock"]);
  return (cards[cards.length - 1] as { id: number }).id;
}

/** Every suit's Ace through King, home, less `missing` from the last foundation. */
function fillFoundations(missing = 0): void {
  const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  suits.forEach((suit, index) => {
    for (let rank = 1; rank <= 13; rank++) {
      if (index === 3 && rank > 13 - missing) continue;
      addCard("foundation", index, suit, rank);
    }
  });
}

/** The centre of the card drawn at the top of column `index`. */
function columnPoint(index: number, row: number): [number, number] {
  const column = h.snapshot().tableau[index] ?? [];
  let y = TABLEAU_Y;
  for (let i = 0; i < row; i++) {
    y += (column[i] as { faceUp: boolean }).faceUp ? 34 : 24;
  }
  return [(COLUMN_X[index] as number) + CARD_W / 2, y + 10];
}

/** Whether any string was drawn inside `rect`. */
function textIn(rect: Rect, value: string): boolean {
  return h.texts.some(
    (t) =>
      t.text === value &&
      t.x >= rect.x - 2 &&
      t.x <= rect.x + rect.w + 2 &&
      t.y >= rect.y - 2 &&
      t.y <= rect.y + rect.h + 2,
  );
}

// ---- The surface ---------------------------------------------------------

describe("the debug surface", () => {
  it("is returned beside the state and reports its version", () => {
    expect(h.debug.version).toBe(CASCADE_DEBUG_VERSION);
    const names = [
      "reset",
      "snapshot",
      "setScreen",
      "addCard",
      "removeCard",
      "setCardFaceUp",
      "clearPile",
      "clearTable",
      "addWasteSet",
      "clearWasteSets",
      "deal",
      "turnStock",
      "move",
      "autoMove",
      "pointerDown",
      "pointerMove",
      "pointerUp",
      "setAutoFlip",
      "setWinDetect",
      "setLaunching",
      "setTrailPainting",
      "addFlyer",
      "setFlyerPosition",
      "setFlyerVelocity",
      "removeFlyer",
      "clearFlyers",
      "setLaunchClock",
      "clearTrail",
    ];
    for (const name of names) {
      expect(typeof (h.debug as unknown as Record<string, unknown>)[name]).toBe(
        "function",
      );
    }
  });

  it("opens on the title screen with a bare table", () => {
    const snap = h.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.stock).toHaveLength(0);
    expect(snap.foundations).toHaveLength(4);
    expect(snap.tableau).toHaveLength(7);
    expect(snap.dealMode).toBe(DEAL_MODE);
    expect(snap.turnCount).toBe(TURN_COUNT);
    expect(snap.dealModeLabel).toBe(DEAL_MODE_LABEL);
  });

  it("reads every pose back through the snapshot", () => {
    h.pose((s, d) => d.setScreen(s, "playing"));
    const id = addCard("tableau", 2, "hearts", 7, false);
    h.pose((s, d) => d.setCardFaceUp(s, id, true));
    h.pose((s, d) => d.addWasteSet(s, 2));
    h.pose((s, d) => d.addWasteSet(s, 3));
    h.pose((s, d) => d.setAutoFlip(s, false));
    h.pose((s, d) => d.setWinDetect(s, false));
    h.pose((s, d) => d.setLaunching(s, false));
    h.pose((s, d) => d.setTrailPainting(s, false));
    h.pose((s, d) => d.addFlyer(s, "clubs", 4, 100, 200, 30, -40));
    const flyerId = (h.snapshot().flyers[0] as { id: number }).id;
    h.pose((s, d) => d.setFlyerPosition(s, flyerId, 400, 500));
    h.pose((s, d) => d.setFlyerVelocity(s, flyerId, 11, 12));
    h.pose((s, d) => d.setLaunchClock(s, 0.09));

    const snap = h.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.tableau[2]?.[0]?.faceUp).toBe(true);
    expect(snap.wasteSets).toEqual([2, 3]);
    expect(snap.wasteVisibleCount).toBe(3);
    expect(snap.autoFlip).toBe(false);
    expect(snap.winDetect).toBe(false);
    expect(snap.launching).toBe(false);
    expect(snap.trailPainting).toBe(false);
    expect(snap.flyers[0]).toMatchObject({ x: 400, y: 500, vx: 11, vy: 12 });
    expect(snap.launchClock).toBeCloseTo(0.09, 6);
  });

  it("reports a card's colour with its suit", () => {
    openTable();
    addCard("tableau", 0, "hearts", 3);
    addCard("tableau", 1, "spades", 3);
    expect(h.snapshot().tableau[0]?.[0]?.color).toBe("red");
    expect(h.snapshot().tableau[1]?.[0]?.color).toBe("black");
  });

  it("appends a card to its own pile and touches nothing else", () => {
    openTable();
    addCard("tableau", 0, "hearts", 3);
    addCard("tableau", 0, "spades", 2);
    h.pose((s, d) => d.addWasteSet(s, 1));
    const before = h.snapshot();
    const id = addCard("tableau", 0, "diamonds", 1);
    const after = h.snapshot();
    expect(after.tableau[0]).toHaveLength(3);
    expect(after.tableau[0]?.[2]?.id).toBe(id);
    expect(after.wasteSets).toEqual(before.wasteSets);
    expect(after.stock).toEqual(before.stock);
    expect(after.foundations).toEqual(before.foundations);
  });

  it("keeps every card's id distinct and stable across a move", () => {
    h.pose((s, d) => d.setScreen(s, "playing"));
    h.pose((s, d) => d.deal(s));
    const snap = h.snapshot();
    const ids = [...snap.stock, ...snap.tableau.flat()].map((c) => c.id);
    expect(new Set(ids).size).toBe(DECK_SIZE);

    openTable();
    const moved = addCard("tableau", 0, "spades", 1);
    expect(
      h.decide((s, d) => d.move(s, "tableau", 0, 0, "foundation", 1)),
    ).toBe(true);
    expect(h.snapshot().foundations[1]?.[0]?.id).toBe(moved);
  });

  it("removes exactly the card named, and takes it off the waste's set", () => {
    openTable();
    const a = addCard("waste", 0, "spades", 5);
    const b = addCard("waste", 0, "hearts", 6);
    h.pose((s, d) => d.addWasteSet(s, 2));
    h.pose((s, d) => d.removeCard(s, b));
    const snap = h.snapshot();
    expect(snap.waste.map((c) => c.id)).toEqual([a]);
    expect(snap.wasteSets).toEqual([1]);
  });

  it("empties one pile, or the whole table, without touching the gates", () => {
    openTable();
    addCard("tableau", 0, "spades", 5);
    addCard("tableau", 1, "hearts", 6);
    addCard("waste", 0, "clubs", 2);
    h.pose((s, d) => d.addWasteSet(s, 1));
    h.pose((s, d) => d.clearPile(s, "waste", 0));
    expect(h.snapshot().waste).toHaveLength(0);
    expect(h.snapshot().wasteSets).toEqual([]);
    expect(h.snapshot().tableau[0]).toHaveLength(1);

    h.pose((s, d) => d.addFlyer(s, "spades", 1, 10, 10, 0, 0));
    h.pose((s, d) => d.clearTable(s));
    const snap = h.snapshot();
    expect(snap.tableau.every((c) => c.length === 0)).toBe(true);
    expect(snap.flyers).toHaveLength(1);
    expect(snap.autoFlip).toBe(true);
  });

  it("poses and clears the waste's sets, and derives the shown count", () => {
    openTable();
    for (let i = 0; i < 4; i++) addCard("waste", 0, "spades", i + 1);
    h.pose((s, d) => d.addWasteSet(s, 3));
    h.pose((s, d) => d.addWasteSet(s, 1));
    expect(h.snapshot().wasteSets).toEqual([3, 1]);
    expect(h.snapshot().wasteVisibleCount).toBe(1);
    h.pose((s, d) => d.clearWasteSets(s));
    expect(h.snapshot().wasteSets).toEqual([]);
    expect(h.snapshot().wasteVisibleCount).toBe(0);
    expect(h.snapshot().waste).toHaveLength(4);
  });

  it("refuses a move naming a waste card that is not shown", () => {
    openTable();
    addCard("waste", 0, "spades", 1);
    h.pose((s, d) => d.clearWasteSets(s));
    expect(h.decide((s, d) => d.move(s, "waste", 0, 0, "foundation", 0))).toBe(
      false,
    );
  });

  it("restores the title values on reset and leaves muting alone", async () => {
    openTable();
    h.pose((s, d) => d.deal(s));
    h.pose((s, d) => d.setAutoFlip(s, false));
    h.pose((s, d) => d.setLaunching(s, false));
    h.pose((s, d) => d.addFlyer(s, "spades", 1, 10, 10, 0, 0));
    h.mouseDown(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    h.mouseUp(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    await h.frames(1);
    expect(h.snapshot().muted).toBe(true);

    h.pose((s, d) => d.reset(s));
    const snap = h.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.stock).toHaveLength(0);
    expect(snap.wasteSets).toEqual([]);
    expect(snap.drag).toBeNull();
    expect(snap.dropTarget).toBeNull();
    expect(snap.lastPress).toBeNull();
    expect(snap.pointer).toEqual({ x: 0, y: 0, down: false });
    expect(snap.autoFlip).toBe(true);
    expect(snap.winDetect).toBe(true);
    expect(snap.launching).toBe(true);
    expect(snap.trailPainting).toBe(true);
    expect(snap.launchClock).toBe(0);
    expect(snap.launched).toBe(0);
    expect(snap.flyers).toHaveLength(0);
    expect(snap.cascadeDone).toBe(false);
    expect(snap.trailStamps).toBe(0);
    expect(snap.simTime).toBe(0);
    expect(snap.muted).toBe(true);
  });

  it("drives the pointer through the surface exactly as a player does", () => {
    openTable();
    addCard("tableau", 0, "hearts", 8);
    addCard("tableau", 1, "spades", 7);
    const [px, py] = columnPoint(1, 0);
    h.pose((s, d) => d.pointerDown(s, px, py));
    expect(h.snapshot().drag?.cards).toHaveLength(1);
    h.pose((s, d) => d.pointerMove(s, px - 122, py));
    expect(h.snapshot().dropTarget).toEqual({ pile: "tableau", index: 0 });
    h.pose((s, d) => d.pointerUp(s, px - 122, py));
    expect(h.snapshot().tableau[0]).toHaveLength(2);
    expect(h.snapshot().drag).toBeNull();
  });

  it("removes one flyer, clears the flight, and ignores an unknown id", () => {
    openTable();
    h.pose((s, d) => d.addFlyer(s, "spades", 1, 10, 20, 1, 2));
    const first = (h.snapshot().flyers[0] as { id: number }).id;
    h.pose((s, d) => d.addFlyer(s, "hearts", 2, 30, 40, 3, 4));
    expect(h.snapshot().flyers).toHaveLength(2);

    h.pose((s, d) => d.setFlyerPosition(s, first + 999, 0, 0));
    h.pose((s, d) => d.setFlyerVelocity(s, first + 999, 0, 0));
    expect(h.snapshot().flyers[0]).toMatchObject({
      x: 10,
      y: 20,
      vx: 1,
      vy: 2,
    });

    h.pose((s, d) => d.removeFlyer(s, first));
    expect(h.snapshot().flyers).toHaveLength(1);
    expect(h.snapshot().flyers[0]?.suit).toBe("hearts");

    h.pose((s, d) => d.clearFlyers(s));
    expect(h.snapshot().flyers).toHaveLength(0);
  });

  it("leaves the board alone for an operation naming no pile or no card", () => {
    openTable();
    addCard("tableau", 0, "spades", 5);
    const before = JSON.stringify(h.snapshot());
    h.pose((s, d) => d.addCard(s, "foundation", 9, "hearts", 3, true));
    h.pose((s, d) => d.clearPile(s, "tableau", 12));
    h.pose((s, d) => d.removeCard(s, 9999));
    h.pose((s, d) => d.setCardFaceUp(s, 9999, false));
    expect(JSON.stringify(h.snapshot())).toBe(before);
    expect(h.decide((s, d) => d.move(s, "tableau", 0, 0, "waste", 0))).toBe(
      false,
    );
    expect(h.decide((s, d) => d.autoMove(s, "waste", 0))).toBe(false);
  });

  it("deals the same board from one seed and different boards from two", () => {
    const deal = (seed: number): string => {
      h.pose((s, d) => d.reset(s, { seed }));
      h.pose((s, d) => d.deal(s));
      return JSON.stringify(h.snapshot().tableau);
    };
    expect(deal(7)).toBe(deal(7));
    expect(deal(7)).not.toBe(deal(8));
  });
});

// ---- Time ----------------------------------------------------------------

describe("the clock", () => {
  it("accumulates game time on every screen", async () => {
    await h.advance(1);
    expect(h.snapshot().simTime).toBeCloseTo(1, 6);
    h.pose((s, d) => d.setScreen(s, "playing"));
    await h.advance(1);
    expect(h.snapshot().simTime).toBeCloseTo(2, 6);
  });

  it("advances on elapsed time alone, however the interval was divided", async () => {
    openTable();
    h.pose((s, d) => d.setLaunching(s, false));
    h.pose((s, d) => d.setTrailPainting(s, false));
    h.pose((s, d) => d.addFlyer(s, "spades", 1, 400, -4000, 200, 0));
    await h.advance(1);
    const fine = h.snapshot();

    const coarse = await createHarness();
    coarse.pose((s, d) => d.clearTable(s));
    coarse.pose((s, d) => d.setScreen(s, "playing"));
    coarse.pose((s, d) => d.setLaunching(s, false));
    coarse.pose((s, d) => d.setTrailPainting(s, false));
    coarse.pose((s, d) => d.addFlyer(s, "spades", 1, 400, -4000, 200, 0));
    coarse.setStep(1);
    await coarse.frames(1);
    const one = coarse.snapshot();

    expect(one.simTime).toBeCloseTo(fine.simTime, 6);
    expect(one.flyers[0]?.x ?? 0).toBeCloseTo(fine.flyers[0]?.x ?? -1, 3);
    coarse.dispose();
  });
});

// ---- The pointer through the engine --------------------------------------

describe("a player's pointer", () => {
  it("lifts a run, follows it, and completes the drop in one frame", async () => {
    openTable();
    addCard("tableau", 0, "hearts", 8);
    addCard("tableau", 1, "spades", 7);
    const [px, py] = columnPoint(1, 0);
    h.mouseDown(px, py);
    h.mouseMove(px - 122, py);
    h.mouseUp(px - 122, py);
    await h.frames(1);
    expect(h.snapshot().tableau[0]).toHaveLength(2);
    expect(h.snapshot().tableau[1]).toHaveLength(0);
  });

  it("turns the stock on a click in its rectangle", async () => {
    openTable();
    for (let i = 0; i < 6; i++) addCard("stock", 0, "spades", i + 1, false);
    h.mouseDown(STOCK_X + 50, TOP_ROW_Y + 70);
    h.mouseUp(STOCK_X + 50, TOP_ROW_Y + 70);
    await h.frames(1);
    expect(h.snapshot().waste).toHaveLength(TURN_COUNT);
  });

  it("reports the press it measures a double click against", async () => {
    openTable();
    h.mouseDown(300, 400);
    await h.frames(1);
    const snap = h.snapshot();
    expect(snap.pointer).toMatchObject({ x: 300, y: 400, down: true });
    expect(snap.lastPress).toMatchObject({ x: 300, y: 400 });
    h.mouseUp(300, 400);
    await h.frames(1);
    expect(h.snapshot().pointer.down).toBe(false);
  });

  it("deals and enters play from the title's NEW GAME", async () => {
    h.mouseDown(TITLE_NEW_GAME.x + 20, TITLE_NEW_GAME.y + 20);
    h.mouseUp(TITLE_NEW_GAME.x + 20, TITLE_NEW_GAME.y + 20);
    await h.frames(1);
    const snap = h.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.stock).toHaveLength(24);
    expect(snap.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("opens the how-to screen and comes back from the HUD", async () => {
    h.mouseDown(TITLE_HOW_TO.x + 20, TITLE_HOW_TO.y + 20);
    h.mouseUp(TITLE_HOW_TO.x + 20, TITLE_HOW_TO.y + 20);
    await h.frames(1);
    expect(h.snapshot().screen).toBe("howto");

    h.pose((s, d) => d.setScreen(s, "playing"));
    h.mouseDown(HUD_MENU.x + 10, HUD_MENU.y + 10);
    h.mouseUp(HUD_MENU.x + 10, HUD_MENU.y + 10);
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
  });

  it("toggles mute from the HUD and back again", async () => {
    h.pose((s, d) => d.setScreen(s, "playing"));
    const tap = async (): Promise<void> => {
      h.mouseDown(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
      h.mouseUp(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
      await h.frames(1);
    };
    await tap();
    expect(h.snapshot().muted).toBe(true);
    await tap();
    expect(h.snapshot().muted).toBe(false);
  });
});

// ---- Audio ---------------------------------------------------------------

describe("the cues", () => {
  it("plays each event's cue on the frame that answers it", async () => {
    openTable();
    for (let i = 0; i < 6; i++) addCard("stock", 0, "spades", i + 1, false);
    h.pose((s, d) => d.turnStock(s));
    await h.frames(1);
    expect(h.cues.map((c) => c.cue)).toContain(CUES.turn);

    h.cues.length = 0;
    h.pose((s, d) => d.deal(s));
    await h.frames(1);
    expect(h.cues.map((c) => c.cue)).toContain(CUES.deal);

    h.cues.length = 0;
    openTable();
    addCard("waste", 0, "spades", 1);
    h.pose((s, d) => d.addWasteSet(s, 1));
    h.decide((s, d) => d.autoMove(s, "waste", 0));
    await h.frames(1);
    expect(h.cues.map((c) => c.cue)).toContain(CUES.home);
  });

  it("plays a cue once on a frame that raised it twice", async () => {
    openTable();
    addCard("waste", 0, "spades", 1);
    h.pose((s, d) => d.addWasteSet(s, 1));
    addCard("tableau", 0, "hearts", 1);
    h.decide((s, d) => d.autoMove(s, "waste", 0));
    h.decide((s, d) => d.autoMove(s, "tableau", 0));
    h.cues.length = 0;
    await h.frames(1);
    expect(h.cues.filter((c) => c.cue === CUES.home)).toHaveLength(1);
  });

  it("sounds a muted cue at no gain and an unmuted one at its own", async () => {
    h.pose((s, d) => d.setScreen(s, "playing"));
    const turn = async (): Promise<CuePlay | undefined> => {
      openTable();
      for (let i = 0; i < 6; i++) addCard("stock", 0, "spades", i + 1, false);
      h.cues.length = 0;
      h.pose((s, d) => d.turnStock(s));
      await h.frames(1);
      return h.cues.find((c) => c.cue === CUES.turn);
    };

    const loud = await turn();
    expect(loud?.gain).toBeGreaterThan(0);

    h.mouseDown(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    h.mouseUp(HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    await h.frames(1);
    const quiet = await turn();
    expect(quiet?.cue).toBe(CUES.turn);
    expect(quiet?.gain).toBe(0);
  });
});

// ---- Draw Three ----------------------------------------------------------

describe("Draw Three", () => {
  it("turns three cards and adds one set of three", () => {
    openTable();
    for (let i = 0; i < 6; i++) addCard("stock", 0, "spades", i + 1, false);
    h.pose((s, d) => d.turnStock(s));
    const snap = h.snapshot();
    expect(snap.stock).toHaveLength(3);
    expect(snap.waste).toHaveLength(3);
    expect(snap.wasteSets).toEqual([3]);
    expect(snap.wasteVisibleCount).toBe(3);
  });

  it("turns all that remain from a short stock", () => {
    openTable();
    addCard("stock", 0, "spades", 1, false);
    addCard("stock", 0, "hearts", 2, false);
    h.pose((s, d) => d.turnStock(s));
    expect(h.snapshot().wasteSets).toEqual([2]);
  });

  it("fans the shown set at the stated positions, clear of its neighbours", async () => {
    openTable();
    for (let i = 0; i < 3; i++) addCard("stock", 0, "spades", i + 1, false);
    h.pose((s, d) => d.turnStock(s));
    await h.frames(1);
    // The three fanned cards are drawn at 346, 372 and 398; the felt shows
    // through at the stock's neighbour and left of the first foundation.
    const cardish = (x: number): boolean =>
      distance(h.pixel(x, TOP_ROW_Y + 70), [23, 122, 74, 255]) > 60;
    expect(cardish(WASTE_X + 4)).toBe(true);
    expect(cardish(WASTE_X + 2 * WASTE_FAN + 4)).toBe(true);
    expect(cardish(WASTE_X + 2 * WASTE_FAN + CARD_W + 6)).toBe(false);
    expect(WASTE_X + 2 * WASTE_FAN + CARD_W).toBeLessThan(
      FOUNDATION_X[0] as number,
    );
  });

  it("counts the fan down within its set and never refills it", () => {
    openTable();
    // Bottom to top: three Aces the second turn will lift, then three cards no
    // foundation takes.
    addCard("stock", 0, "spades", 1, false);
    addCard("stock", 0, "hearts", 1, false);
    addCard("stock", 0, "diamonds", 1, false);
    addCard("stock", 0, "spades", 9, false);
    addCard("stock", 0, "hearts", 8, false);
    addCard("stock", 0, "spades", 7, false);
    h.pose((s, d) => d.turnStock(s));
    h.pose((s, d) => d.turnStock(s));
    expect(h.snapshot().wasteVisibleCount).toBe(3);
    expect(h.snapshot().waste).toHaveLength(6);

    // Within the set the fan counts down and is never refilled from the cards
    // buried behind it; only an emptied set falls back to the one before it.
    for (const [shown, held] of [
      [2, 5],
      [1, 4],
      [3, 3],
    ]) {
      expect(h.decide((s, d) => d.autoMove(s, "waste", 0))).toBe(true);
      expect(h.snapshot().wasteVisibleCount).toBe(shown);
      expect(h.snapshot().waste).toHaveLength(held as number);
    }
  });

  it("falls back to what the earlier turn was left with", () => {
    openTable();
    // Bottom to top: three Aces, a fourth Ace, then five cards no foundation
    // will take. Turn, turn, send one home, turn, send all three home.
    addCard("stock", 0, "hearts", 1, false);
    addCard("stock", 0, "diamonds", 1, false);
    addCard("stock", 0, "clubs", 1, false);
    addCard("stock", 0, "spades", 1, false);
    const fallback = addCard("stock", 0, "spades", 9, false);
    addCard("stock", 0, "hearts", 8, false);
    addCard("stock", 0, "spades", 7, false);
    addCard("stock", 0, "hearts", 6, false);
    addCard("stock", 0, "spades", 5, false);

    h.pose((s, d) => d.turnStock(s));
    h.pose((s, d) => d.turnStock(s));
    expect(h.snapshot().wasteSets).toEqual([3, 3]);
    expect(h.decide((s, d) => d.autoMove(s, "waste", 0))).toBe(true);
    expect(h.snapshot().wasteSets).toEqual([3, 2]);

    h.pose((s, d) => d.turnStock(s));
    expect(h.snapshot().wasteSets).toEqual([3, 2, 3]);
    for (let i = 0; i < 3; i++) {
      expect(h.decide((s, d) => d.autoMove(s, "waste", 0))).toBe(true);
    }

    const snap = h.snapshot();
    expect(snap.wasteSets).toEqual([3, 2]);
    expect(snap.wasteVisibleCount).toBe(2);
    expect(snap.waste).toHaveLength(5);
    expect(snap.waste[snap.waste.length - 1]?.id).toBe(fallback);
  });

  it("shows one card fewer while the front of the set is in hand", async () => {
    openTable();
    for (let i = 0; i < 6; i++) addCard("stock", 0, "spades", i + 1, false);
    h.pose((s, d) => d.turnStock(s));
    h.pose((s, d) => d.turnStock(s));
    await h.frames(1);
    const felt: Rgba = [23, 122, 74, 255];
    const third = WASTE_X + 2 * WASTE_FAN + 50;
    // Right of where the second fanned card reaches, so only the third covers it.
    const beyond = WASTE_X + WASTE_FAN + CARD_W + 8;
    expect(distance(h.pixel(beyond, TOP_ROW_Y + 70), felt)).toBeGreaterThan(90);

    // Lifted and carried away, the front card leaves the fan showing the two of
    // its own set that are still on the pile, and pulls none up from beneath.
    h.mouseDown(third, TOP_ROW_Y + 70);
    h.mouseMove(700, 460);
    await h.frames(1);
    expect(h.snapshot().drag?.cards).toHaveLength(1);
    expect(distance(h.pixel(beyond, TOP_ROW_Y + 70), felt)).toBeLessThan(10);
    expect(
      distance(h.pixel(WASTE_X + WASTE_FAN + 10, TOP_ROW_Y + 70), felt),
    ).toBeGreaterThan(90);

    h.mouseUp(700, 460);
    await h.frames(1);
    expect(h.snapshot().waste).toHaveLength(6);
    expect(distance(h.pixel(beyond, TOP_ROW_Y + 70), felt)).toBeGreaterThan(90);
  });

  it("refuses a move naming a card behind the frontmost fanned one", () => {
    openTable();
    for (let i = 0; i < 3; i++) addCard("stock", 0, "spades", i + 1, false);
    h.pose((s, d) => d.turnStock(s));
    expect(h.decide((s, d) => d.move(s, "waste", 0, 0, "foundation", 0))).toBe(
      false,
    );
    expect(h.decide((s, d) => d.move(s, "waste", 0, 1, "foundation", 0))).toBe(
      false,
    );
  });
});

// ---- The cascade through the engine --------------------------------------

describe("the victory cascade", () => {
  it("begins with the win and launches on its first frame", async () => {
    openTable();
    h.pose((s, d) => d.setScreen(s, "playing"));
    fillFoundations(1);
    addCard("tableau", 0, "clubs", 13);
    h.cues.length = 0;
    expect(
      h.decide((s, d) => d.move(s, "tableau", 0, 0, "foundation", 3)),
    ).toBe(true);
    expect(h.snapshot().screen).toBe("won");
    await h.frames(1);
    expect(h.cues.map((c) => c.cue)).toContain(CUES.win);
    expect(h.snapshot().launched).toBe(1);
    expect(h.snapshot().launchClock).toBeCloseTo(1 / 240, 6);
  });

  it("paints the table, keeps the paint, and clears it on a fresh deal", async () => {
    openTable();
    h.pose((s, d) => d.setScreen(s, "playing"));
    fillFoundations(1);
    addCard("tableau", 0, "clubs", 13);
    h.decide((s, d) => d.move(s, "tableau", 0, 0, "foundation", 3));
    await h.advance(3);
    expect(h.snapshot().trailStamps).toBeGreaterThan(0);

    h.setStep(1 / 60);
    await h.frames(60 * 16);
    const done = h.snapshot();
    expect(done.launched).toBe(DECK_SIZE);
    expect(done.flyers).toHaveLength(0);
    expect(done.cascadeDone).toBe(true);
    expect(done.trailStamps).toBeGreaterThan(100);

    // The felt is buried, and `YOU WIN` is drawn over it.
    expect(h.texts.some((t) => t.text === WIN_TEXT)).toBe(true);

    h.mouseDown(640, 360);
    h.mouseUp(640, 360);
    await h.frames(1);
    const fresh = h.snapshot();
    expect(fresh.screen).toBe("playing");
    expect(fresh.trailStamps).toBe(0);
    expect(fresh.stock).toHaveLength(24);
  });

  it("stops painting while the gate is off and clears on demand", async () => {
    openTable();
    h.pose((s, d) => d.addFlyer(s, "spades", 5, 500, 200, 40, 0));
    await h.advance(0.5);
    const painted = h.snapshot().trailStamps;
    expect(painted).toBeGreaterThan(0);

    h.pose((s, d) => d.setTrailPainting(s, false));
    await h.advance(0.5);
    expect(h.snapshot().trailStamps).toBe(painted);
    expect(h.snapshot().flyers).toHaveLength(1);

    h.pose((s, d) => d.clearTrail(s));
    expect(h.snapshot().trailStamps).toBe(0);
    expect(h.snapshot().flyers).toHaveLength(1);
  });
});

// ---- What the table looks like -------------------------------------------

describe("the drawing", () => {
  const FELT: Rgba = [23, 122, 74, 255];

  it("draws the title screen's copy", async () => {
    await h.frames(1);
    const drawn = h.texts.map((t) => t.text);
    expect(drawn).toContain(TITLE_TEXT);
    expect(drawn).toContain(TAGLINE_TEXT);
    expect(drawn).toContain(DEAL_MODE_LABEL);
    expect(textIn(TITLE_NEW_GAME, TITLE_ITEMS[0])).toBe(true);
    expect(textIn(TITLE_HOW_TO, TITLE_ITEMS[1])).toBe(true);
  });

  it("draws each of the how-to screen's four tokens as a word", async () => {
    h.pose((s, d) => d.setScreen(s, "howto"));
    await h.frames(1);
    const copy = h.texts.map((t) => t.text).join(" ");
    for (const token of ["ACE", "KING", "STOCK", "DOUBLE-CLICK"]) {
      expect(new RegExp(`\\b${token}\\b`).test(copy)).toBe(true);
    }
  });

  it("draws every HUD label inside its own rectangle, and the deal mode", async () => {
    h.pose((s, d) => d.setScreen(s, "playing"));
    await h.frames(1);
    expect(textIn(HUD_NEW_GAME, HUD_ITEMS[0])).toBe(true);
    expect(textIn(HUD_MENU, HUD_ITEMS[1])).toBe(true);
    expect(textIn(HUD_SOUND, HUD_ITEMS[2])).toBe(true);
    expect(h.texts.map((t) => t.text)).toContain(DEAL_MODE_LABEL);
  });

  it("draws a card of the right size at its anchor", async () => {
    openTable();
    addCard("tableau", 3, "hearts", 5);
    await h.frames(1);
    const x = COLUMN_X[3] as number;
    expect(distance(h.pixel(x + 4, TABLEAU_Y + 4), FELT)).toBeGreaterThan(90);
    expect(
      distance(h.pixel(x + CARD_W - 4, TABLEAU_Y + CARD_H - 4), FELT),
    ).toBeGreaterThan(90);
    expect(distance(h.pixel(x - 6, TABLEAU_Y + 60), FELT)).toBeLessThan(10);
    expect(
      distance(h.pixel(x + CARD_W + 6, TABLEAU_Y + 60), FELT),
    ).toBeLessThan(10);
  });

  it("tells a red suit from a black one on the pip", async () => {
    openTable();
    addCard("tableau", 0, "hearts", 5);
    addCard("tableau", 1, "spades", 5);
    await h.frames(1);
    const red = h.pixel((COLUMN_X[0] as number) + 50, TABLEAU_Y + 74);
    const black = h.pixel((COLUMN_X[1] as number) + 50, TABLEAU_Y + 74);
    expect(distance(red, black)).toBeGreaterThan(90);
  });

  it("tells a back from a face and both from the felt", async () => {
    openTable();
    addCard("tableau", 0, "hearts", 5, true);
    addCard("tableau", 1, "hearts", 5, false);
    await h.frames(1);
    const face = h.pixel((COLUMN_X[0] as number) + 50, TABLEAU_Y + 6);
    const back = h.pixel((COLUMN_X[1] as number) + 50, TABLEAU_Y + 6);
    expect(distance(face, back)).toBeGreaterThan(90);
    expect(distance(face, FELT)).toBeGreaterThan(90);
    expect(distance(back, FELT)).toBeGreaterThan(60);
  });

  it("draws an empty pile as a slot that reads apart from the felt", async () => {
    openTable();
    await h.frames(1);
    const slot = h.pixel((COLUMN_X[5] as number) + 50, TABLEAU_Y + 70);
    expect(distance(slot, FELT)).toBeGreaterThan(30);
  });

  it("draws a held run over the pile it passes, and marks its target", async () => {
    openTable();
    addCard("tableau", 0, "hearts", 8);
    addCard("tableau", 1, "spades", 7);
    await h.frames(1);
    const plain = h.pixel((COLUMN_X[0] as number) + 3, TABLEAU_Y + 3);

    const [px, py] = columnPoint(1, 0);
    h.mouseDown(px, py);
    // Far enough left that the run's leading centre lies in column 0's
    // rectangle, and not so far that the run covers the anchor it marks.
    h.mouseMove(px - 102, py);
    await h.frames(1);
    expect(h.snapshot().dropTarget).toEqual({ pile: "tableau", index: 0 });
    const marked = h.pixel((COLUMN_X[0] as number) + 3, TABLEAU_Y + 3);
    expect(distance(plain, marked)).toBeGreaterThan(60);
  });

  it("draws the cards still on the foundations while the cascade runs", async () => {
    openTable();
    h.pose((s, d) => d.setScreen(s, "playing"));
    fillFoundations(1);
    addCard("tableau", 0, "clubs", 13);
    h.decide((s, d) => d.move(s, "tableau", 0, 0, "foundation", 3));
    h.pose((s, d) => d.setTrailPainting(s, false));
    await h.advance(0.5);
    expect(h.snapshot().launched).toBeGreaterThan(0);
    const onTable = h.pixel((FOUNDATION_X[2] as number) + 50, TOP_ROW_Y + 6);
    expect(distance(onTable, FELT)).toBeGreaterThan(90);
  });
});
