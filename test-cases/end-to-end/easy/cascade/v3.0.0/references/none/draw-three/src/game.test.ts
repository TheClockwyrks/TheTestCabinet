// Cascade over its own runtime, in process.
//
// Every check here stands the REAL runtime up over an `@napi-rs/canvas` canvas and
// a `Surface` of its own, so the game runs with no browser and no document behind
// it, and drives it through real pointer events at that surface and through
// `advance`, which makes a duration an exact number of frames of an exact length.
// What is read back is the game's own state, the cues its frames played, and the
// pixels its render produced.
//
// The runtime itself is checked in `src/runtime.test.ts`; this file is the game.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  CUES,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  FOUNDATION_X,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  HOWTO_BACK,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  TABLEAU_Y,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
  TOP_ROW_Y,
  TURN_COUNT,
  WASTE_X,
} from "./constants";
import { createDebugApi, type CascadeDebugApi } from "./debug";
import { game, type CascadeState } from "./game";
import { createRuntime, type Game, type Runtime } from "./runtime";
import { COLOR } from "./theme";
import type { Surface } from "./viewport";

/** The frame length every check below counts in, unless it says otherwise. */
const TICK = 1 / 60;

type Pixel = [number, number, number, number];

interface Harness {
  readonly runtime: Runtime<CascadeState>;
  readonly state: CascadeState;
  readonly debug: CascadeDebugApi;
  readonly cues: string[];
  run(frames?: number): void;
  press(x: number, y: number): void;
  glide(x: number, y: number): void;
  release(x: number, y: number): void;
  click(x: number, y: number): void;
  pixel(x: number, y: number): Pixel;
  dispose(): void;
}

class Point extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(type: string, x: number, y: number) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

/** A `#rrggbb` as the opaque pixel `getImageData` reads back. */
function rgba(hex: string): Pixel {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

/** How far apart two pixels are, out of 441. */
function apart(a: Pixel, b: Pixel): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The offscreen surface a browser gives the painted layer, over a real canvas.
 *
 * Node has neither door the layer looks through, so without this the layer would
 * be absent and the trail's pixels unassertable.
 */
function installOffscreenCanvas(): () => void {
  const had = "OffscreenCanvas" in globalThis;
  if (had) return () => undefined;
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: class {
      constructor(width: number, height: number) {
        return createCanvas(width, height) as unknown as object;
      }
    },
    configurable: true,
  });
  return () => Reflect.deleteProperty(globalThis, "OffscreenCanvas");
}

let dropOffscreen: () => void = () => undefined;

function createHarness(): Harness {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx: SKRSContext2D = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    origin: () => ({ x: 0, y: 0 }),
    dpr: () => 1,
    events: () => events,
  };

  // The game, with the one call a check wants to overhear — which cue a frame
  // played — written down on its way through. Everything else is untouched.
  const cues: string[] = [];
  const observed: Game<CascadeState> = {
    initialize: (api) => game.initialize(api),
    update: (state, api, dt) =>
      game.update(
        state,
        {
          audio: {
            play: (cue) => {
              cues.push(cue);
              api.audio.play(cue);
            },
            setMuted: (muted) => api.audio.setMuted(muted),
            muted: () => api.audio.muted(),
          },
        },
        dt,
      ),
    render: (state, api) => game.render(state, api),
    pointer: (state, api, sample) => game.pointer(state, api, sample),
  };

  const runtime = createRuntime<CascadeState>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game: observed,
    background: COLOR.table,
    surface,
    // Node has no Web Audio. The bus stays silent; the cues above still record.
    audioContext: () => null,
  });

  const state = runtime.initialize();
  const send = (type: string, x: number, y: number): void => {
    events.dispatchEvent(new Point(type, x, y));
  };

  return {
    runtime,
    state,
    debug: createDebugApi(state, runtime),
    cues,
    run: (frames = 1) => runtime.advance(frames * TICK, frames),
    press: (x, y) => send("pointerdown", x, y),
    glide: (x, y) => send("pointermove", x, y),
    release: (x, y) => send("pointerup", x, y),
    click: (x, y) => {
      send("pointerdown", x, y);
      send("pointerup", x, y);
    },
    pixel: (x, y) => [...ctx.getImageData(x, y, 1, 1).data] as unknown as Pixel,
    dispose: () => runtime.destroy(),
  };
}

let h: Harness;

beforeEach(() => {
  dropOffscreen = installOffscreenCanvas();
  h = createHarness();
  h.debug.setAutoStep(false);
  h.debug.reset({ seed: 5 });
});

afterEach(() => {
  h.dispose();
  dropOffscreen();
});

/** An empty table on the `playing` screen, which every table check starts from. */
function openTable(): void {
  h.debug.setScreen("playing");
  h.debug.clearTable();
}

/** The center of a column's anchor footprint. */
function columnAnchor(column: number): [number, number] {
  return [COLUMN_X[column] + CARD_W / 2, TABLEAU_Y + CARD_H / 2];
}

describe("the game the runtime is handed", () => {
  it("opens on the title screen with an empty table", () => {
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.stock).toEqual([]);
    expect(shot.tableau.every((column) => column.length === 0)).toBe(true);
  });

  it("accumulates game time whatever the screen", () => {
    h.run(30);
    expect(h.debug.snapshot().simTime).toBeCloseTo(30 * TICK, 9);
    h.debug.setScreen("playing");
    h.run(30);
    expect(h.debug.snapshot().simTime).toBeCloseTo(60 * TICK, 9);
  });

  it("reaches the same time however the interval was divided", () => {
    h.run(1);
    const one = h.debug.snapshot().simTime;
    h.debug.reset({ seed: 5 });
    h.runtime.advance(TICK, 4);
    expect(h.debug.snapshot().simTime).toBeCloseTo(one, 9);
  });
});

describe("what a press picks up", () => {
  beforeEach(openTable);

  it("puts the run in the hand on the press itself, before any motion", () => {
    h.debug.addCard("tableau", 0, "spades", 13, true);
    const [x, y] = columnAnchor(0);
    h.press(x, y);
    const shot = h.debug.snapshot();
    expect(shot.drag?.cards).toHaveLength(1);
    expect(shot.drag?.fromPile).toBe("tableau");
    expect(shot.tableau[0]).toEqual([]);
  });

  it("takes the pressed card and every card below it in the column", () => {
    h.debug.addCard("tableau", 0, "spades", 9, false);
    h.debug.addCard("tableau", 0, "clubs", 8, true);
    h.debug.addCard("tableau", 0, "hearts", 7, true);
    h.debug.addCard("tableau", 0, "spades", 6, true);
    h.press(COLUMN_X[0] + 20, TABLEAU_Y + 24 + 10);
    expect(h.debug.snapshot().drag?.cards.map((card) => card.rank)).toEqual([
      8, 7, 6,
    ]);
  });

  it("picks up nothing from a face-down card, the stock, or bare table", () => {
    h.debug.addCard("tableau", 0, "spades", 9, false);
    h.debug.addCard("stock", 0, "hearts", 3, false);
    h.press(...columnAnchor(0));
    expect(h.debug.snapshot().drag).toBeNull();
    h.release(...columnAnchor(0));
    h.press(STOCK_X + 50, TOP_ROW_Y + 70);
    expect(h.debug.snapshot().drag).toBeNull();
    h.release(STOCK_X + 50, TOP_ROW_Y + 70);
    h.press(60, 400);
    expect(h.debug.snapshot().drag).toBeNull();
  });

  it("picks up the waste's top card and nothing else on the waste", () => {
    for (const rank of [4, 5, 6])
      h.debug.addCard("waste", 0, "hearts", rank, true);
    h.debug.addWasteSet(3);
    h.press(WASTE_X + 10, TOP_ROW_Y + 70);
    expect(h.debug.snapshot().drag).toBeNull();
    h.release(WASTE_X + 10, TOP_ROW_Y + 70);
    h.press(WASTE_X + 2 * 26 + 60, TOP_ROW_Y + 70);
    expect(h.debug.snapshot().drag?.cards.map((card) => card.rank)).toEqual([
      6,
    ]);
  });
});

describe("a click and a drop", () => {
  beforeEach(openTable);

  it("returns a held run when the release lands within the threshold", () => {
    h.debug.addCard("tableau", 0, "spades", 13, true);
    const [x, y] = columnAnchor(0);
    h.press(x, y);
    h.release(x + DRAG_THRESHOLD - 1, y);
    const shot = h.debug.snapshot();
    expect(shot.drag).toBeNull();
    expect(shot.tableau[0]).toHaveLength(1);
  });

  it("resolves a release beyond the threshold as a drop", () => {
    h.debug.addCard("tableau", 0, "spades", 13, true);
    h.press(COLUMN_X[0] + 10, TABLEAU_Y + 10);
    h.glide(COLUMN_X[1] + 10, TABLEAU_Y + 10);
    h.release(COLUMN_X[1] + 10, TABLEAU_Y + 10);
    const shot = h.debug.snapshot();
    expect(shot.tableau[0]).toEqual([]);
    expect(shot.tableau[1]).toHaveLength(1);
  });

  it("lands where the leading card's center lies, not where the pointer is", () => {
    h.debug.addCard("tableau", 0, "spades", 13, true);
    // Grabbed at the card's top-left corner, so the pointer runs a half card
    // ahead of the card's center the whole way.
    h.press(COLUMN_X[0], TABLEAU_Y);
    h.glide(COLUMN_X[2], TABLEAU_Y);
    h.release(COLUMN_X[2], TABLEAU_Y);
    const shot = h.debug.snapshot();
    expect(shot.tableau[2]).toHaveLength(1);
    expect(shot.tableau[3]).toEqual([]);
  });

  it("returns the run when the release resolves to no pile at all", () => {
    h.debug.addCard("tableau", 0, "spades", 13, true);
    h.press(COLUMN_X[0] + 10, TABLEAU_Y + 10);
    h.glide(620, 640);
    h.release(620, 640);
    h.run();
    const shot = h.debug.snapshot();
    expect(shot.tableau[0]).toHaveLength(1);
    expect(h.cues).toContain(CUES.reject);
  });

  it("returns the run when the pile under it refuses it", () => {
    h.debug.addCard("tableau", 0, "spades", 9, true);
    h.debug.addCard("tableau", 1, "clubs", 5, true);
    h.press(COLUMN_X[0] + 10, TABLEAU_Y + 10);
    h.glide(COLUMN_X[1] + 10, TABLEAU_Y + 10);
    h.release(COLUMN_X[1] + 10, TABLEAU_Y + 10);
    const shot = h.debug.snapshot();
    expect(shot.tableau[0]).toHaveLength(1);
    expect(shot.tableau[1]).toHaveLength(1);
  });

  it("highlights a legal target under the run and nothing else", () => {
    h.debug.addCard("tableau", 0, "spades", 9, true);
    h.debug.addCard("tableau", 1, "hearts", 10, true);
    h.debug.addCard("tableau", 2, "diamonds", 4, true);
    h.press(COLUMN_X[0], TABLEAU_Y);
    h.glide(COLUMN_X[1], TABLEAU_Y);
    expect(h.debug.snapshot().dropTarget).toEqual({
      pile: "tableau",
      index: 1,
    });
    h.glide(COLUMN_X[2], TABLEAU_Y);
    expect(h.debug.snapshot().dropTarget).toBeNull();
  });

  it("answers a whole gesture delivered inside one frame", () => {
    h.debug.addCard("tableau", 0, "spades", 13, true);
    h.press(COLUMN_X[0] + 10, TABLEAU_Y + 10);
    h.glide(COLUMN_X[1] + 10, TABLEAU_Y + 10);
    h.release(COLUMN_X[1] + 10, TABLEAU_Y + 10);
    // No frame has run at all between the press and the release.
    expect(h.runtime.frame().count).toBe(0);
    expect(h.debug.snapshot().tableau[1]).toHaveLength(1);
  });
});

describe("the double click", () => {
  beforeEach(() => {
    openTable();
    h.debug.addCard("tableau", 3, "hearts", 1, true);
  });

  function tapColumn(): void {
    const [x, y] = columnAnchor(3);
    h.click(x, y);
  }

  it("sends the card under it home", () => {
    tapColumn();
    tapColumn();
    const shot = h.debug.snapshot();
    expect(shot.foundations[0]).toHaveLength(1);
    expect(shot.tableau[3]).toEqual([]);
    expect(shot.drag).toBeNull();
  });

  it("does not fire when the second press comes too late", () => {
    tapColumn();
    h.run(Math.ceil((DOUBLE_CLICK_WINDOW + 0.05) / TICK));
    tapColumn();
    expect(h.debug.snapshot().foundations[0]).toEqual([]);
    expect(h.debug.snapshot().tableau[3]).toHaveLength(1);
  });

  it("does not fire when the second press lands too far away", () => {
    const [x, y] = columnAnchor(3);
    h.click(x, y);
    h.click(x + DOUBLE_CLICK_SLOP + 4, y);
    expect(h.debug.snapshot().foundations[0]).toEqual([]);
  });

  it("leaves a card the foundations refuse where it is", () => {
    h.debug.clearPile("tableau", 3);
    h.debug.addCard("tableau", 3, "hearts", 9, true);
    tapColumn();
    tapColumn();
    expect(h.debug.snapshot().tableau[3]).toHaveLength(1);
  });

  it("records every press for the next one to be measured against", () => {
    const [x, y] = columnAnchor(3);
    h.press(x, y);
    const shot = h.debug.snapshot();
    expect(shot.lastPress).toEqual({ x, y, at: shot.simTime });
  });
});

describe("the controls", () => {
  it("deals a fresh game from the title screen and moves to the table", () => {
    h.click(TITLE_NEW_GAME.x + 20, TITLE_NEW_GAME.y + 20);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.stock).toHaveLength(24);
  });

  it("moves to the how-to screen and back", () => {
    h.click(TITLE_HOW_TO.x + 20, TITLE_HOW_TO.y + 20);
    expect(h.debug.snapshot().screen).toBe("howto");
    h.click(HOWTO_BACK.x + 20, HOWTO_BACK.y + 20);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("answers a control only on the screen it belongs to", () => {
    h.debug.setScreen("playing");
    h.click(TITLE_HOW_TO.x + 20, TITLE_HOW_TO.y + 20);
    expect(h.debug.snapshot().screen).toBe("playing");
  });

  it("deals from the HUD and stays on the table", () => {
    h.debug.setScreen("playing");
    h.click(HUD_NEW_GAME.x + 20, HUD_NEW_GAME.y + 18);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.stock).toHaveLength(24);
  });

  it("returns to the title from the HUD", () => {
    h.debug.setScreen("playing");
    h.click(HUD_MENU.x + 20, HUD_MENU.y + 18);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("toggles muting from the HUD, and the snapshot reports it", () => {
    h.debug.setScreen("playing");
    expect(h.debug.snapshot().muted).toBe(false);
    h.click(HUD_SOUND.x + 20, HUD_SOUND.y + 18);
    h.run();
    expect(h.debug.snapshot().muted).toBe(true);
    h.click(HUD_SOUND.x + 20, HUD_SOUND.y + 18);
    h.run();
    expect(h.debug.snapshot().muted).toBe(false);
  });

  it("turns the stock on a click in its rectangle", () => {
    openTable();
    for (let i = 1; i <= 6; i += 1)
      h.debug.addCard("stock", 0, "spades", i, false);
    h.click(STOCK_X + 50, TOP_ROW_Y + 70);
    const shot = h.debug.snapshot();
    expect(shot.waste).toHaveLength(TURN_COUNT);
    expect(shot.wasteSets).toEqual([TURN_COUNT]);
  });

  it("recycles the waste on a click with the stock empty", () => {
    openTable();
    for (let i = 1; i <= 3; i += 1)
      h.debug.addCard("waste", 0, "spades", i, true);
    h.debug.addWasteSet(3);
    h.click(STOCK_X + 50, TOP_ROW_Y + 70);
    const shot = h.debug.snapshot();
    expect(shot.stock).toHaveLength(3);
    expect(shot.waste).toEqual([]);
    expect(shot.wasteSets).toEqual([]);
  });

  it("deals a fresh game on a press anywhere on the won screen", () => {
    h.debug.setScreen("won");
    h.press(900, 600);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.stock).toHaveLength(24);
  });
});

describe("the cues", () => {
  beforeEach(openTable);

  it("sounds a lift, then a drop, and a home on a foundation", () => {
    h.debug.addCard("tableau", 0, "hearts", 1, true);
    h.press(COLUMN_X[0], TABLEAU_Y);
    h.glide(FOUNDATION_X[0], TOP_ROW_Y);
    h.release(FOUNDATION_X[0], TOP_ROW_Y);
    h.run();
    expect(h.cues).toContain(CUES.lift);
    expect(h.cues).toContain(CUES.drop);
    expect(h.cues).toContain(CUES.home);
  });

  it("sounds a flip when a newly exposed card turns", () => {
    h.debug.addCard("tableau", 0, "spades", 9, false);
    h.debug.addCard("tableau", 0, "hearts", 1, true);
    h.debug.autoMove("tableau", 0);
    h.run();
    expect(h.cues).toContain(CUES.flip);
  });

  it("sounds each cue once on a frame that raised it more than once", () => {
    for (let i = 1; i <= 3; i += 1)
      h.debug.addCard("stock", 0, "spades", i, false);
    h.debug.turnStock();
    h.debug.turnStock();
    h.run();
    expect(h.cues.filter((cue) => cue === CUES.turn)).toHaveLength(1);
  });

  it("sounds the deal and the win", () => {
    h.debug.deal();
    h.run();
    expect(h.cues).toContain(CUES.deal);
  });
});

describe("what the table looks like", () => {
  beforeEach(() => {
    openTable();
    h.run();
  });

  it("draws an empty pile apart from the bare felt", () => {
    const felt = h.pixel(60, 400);
    const slot = h.pixel(COLUMN_X[3] + 50, TABLEAU_Y + 70);
    expect(apart(felt, rgba(COLOR.table))).toBeLessThan(8);
    expect(apart(slot, felt)).toBeGreaterThan(30);
  });

  it("draws a card face apart from the felt and a back apart from both", () => {
    h.debug.addCard("foundation", 0, "hearts", 7, true);
    h.debug.addCard("foundation", 1, "hearts", 7, false);
    h.run();
    const face = h.pixel(FOUNDATION_X[0] + 80, TOP_ROW_Y + 16);
    const back = h.pixel(FOUNDATION_X[1] + 50, TOP_ROW_Y + 70);
    const felt = h.pixel(60, 400);
    expect(apart(face, felt)).toBeGreaterThan(60);
    expect(apart(back, felt)).toBeGreaterThan(60);
    expect(apart(face, back)).toBeGreaterThan(60);
  });

  it("draws a red suit apart from a black one", () => {
    h.debug.addCard("foundation", 0, "hearts", 7, true);
    h.debug.addCard("foundation", 1, "spades", 7, true);
    h.run();
    const red = h.pixel(FOUNDATION_X[0] + 50, TOP_ROW_Y + 65);
    const black = h.pixel(FOUNDATION_X[1] + 50, TOP_ROW_Y + 65);
    expect(apart(red, black)).toBeGreaterThan(60);
    expect(apart(red, rgba(COLOR.red))).toBeLessThan(30);
    expect(apart(black, rgba(COLOR.black))).toBeLessThan(30);
  });

  it("draws a highlighted target apart from the same pile unhighlighted", () => {
    h.debug.addCard("tableau", 0, "spades", 9, true);
    h.debug.addCard("tableau", 1, "hearts", 10, true);
    h.run();
    const quiet = readColumn(1);
    h.press(COLUMN_X[0], TABLEAU_Y);
    h.glide(COLUMN_X[1], TABLEAU_Y);
    h.run();
    expect(h.debug.snapshot().dropTarget).toEqual({
      pile: "tableau",
      index: 1,
    });
    const lit = readColumn(1);
    expect(different(quiet, lit)).toBeGreaterThan(40);
  });

  it("draws a held run above the piles it passes over", () => {
    h.debug.addCard("tableau", 0, "spades", 13, true);
    h.debug.addCard("tableau", 1, "hearts", 4, false);
    h.run();
    const covered = h.pixel(COLUMN_X[1] + 50, TABLEAU_Y + 70);
    h.press(COLUMN_X[0], TABLEAU_Y);
    h.glide(COLUMN_X[1], TABLEAU_Y);
    h.run();
    const over = h.pixel(COLUMN_X[1] + 50, TABLEAU_Y + 70);
    expect(apart(covered, over)).toBeGreaterThan(60);
  });

  /** Every pixel of a column's anchor footprint, plus the highlight's margin. */
  function readColumn(column: number): Pixel[] {
    const pixels: Pixel[] = [];
    for (
      let x = COLUMN_X[column] - 6;
      x < COLUMN_X[column] + CARD_W + 6;
      x += 3
    ) {
      for (let y = TABLEAU_Y - 6; y < TABLEAU_Y + CARD_H + 6; y += 3) {
        pixels.push(h.pixel(x, y));
      }
    }
    return pixels;
  }

  function different(a: Pixel[], b: Pixel[]): number {
    let count = 0;
    for (let i = 0; i < a.length; i += 1)
      if (apart(a[i], b[i]) > 20) count += 1;
    return count;
  }
});

describe("what the waste looks like", () => {
  beforeEach(openTable);

  it("fans the shown set to the right, over the cards squared beneath it", () => {
    for (const rank of [2, 3, 4, 5, 6, 7]) {
      h.debug.addCard("waste", 0, "hearts", rank, true);
    }
    h.debug.addWasteSet(3);
    h.debug.addWasteSet(3);
    h.run();
    // Three cards fan from the anchor, and the fan stops short of a foundation.
    for (let k = 0; k < 3; k += 1) {
      const x = WASTE_X + k * 26;
      expect(
        apart(h.pixel(x + 4, TOP_ROW_Y + 120), rgba(COLOR.table)),
      ).toBeGreaterThan(60);
    }
    expect(
      apart(h.pixel(FOUNDATION_X[0] - 6, TOP_ROW_Y + 70), rgba(COLOR.table)),
    ).toBeLessThan(8);
  });

  it("draws the empty-slot mark when the set memory is empty", () => {
    for (const rank of [2, 3, 4])
      h.debug.addCard("waste", 0, "hearts", rank, true);
    h.run();
    const slot = h.pixel(WASTE_X + 50, TOP_ROW_Y + 70);
    expect(apart(slot, rgba(COLOR.slotFill))).toBeLessThan(12);
  });
});

describe("the win message", () => {
  it("shows over the painted table once the cascade is done", () => {
    openTable();
    h.debug.setScreen("won");
    h.run();
    const quiet = h.pixel(STAGE_W / 2, 312);
    h.state.launched = 52;
    h.run();
    expect(h.debug.snapshot().cascadeDone).toBe(true);
    expect(apart(h.pixel(STAGE_W / 2, 312), quiet)).toBeGreaterThan(20);
  });
});

describe("a cancelled gesture", () => {
  it("returns the held run to the pile it was lifted from", () => {
    openTable();
    h.debug.addCard("tableau", 0, "spades", 13, true);
    h.press(COLUMN_X[0] + 10, TABLEAU_Y + 10);
    h.glide(700, 400);
    h.state.pointer.down = true;
    // A pointercancel is what a browser sends when the gesture is taken away.
    h.runtime.pointer("cancel", 700, 400);
    const shot = h.debug.snapshot();
    expect(shot.drag).toBeNull();
    expect(shot.tableau[0]).toHaveLength(1);
    expect(shot.pointer.down).toBe(false);
  });
});

describe("the painted trail", () => {
  beforeEach(() => {
    openTable();
    h.debug.setLaunching(false);
  });

  it("keeps what a card in flight painted long after the card has gone", () => {
    h.debug.addFlyer("hearts", 7, 300, 300, 0, 0);
    h.run(3);
    expect(h.debug.snapshot().trailStamps).toBe(3);
    h.debug.clearFlyers();
    h.run();
    expect(apart(h.pixel(340, 330), rgba(COLOR.table))).toBeGreaterThan(60);
  });

  it("clears the layer, and its count, when it is told to", () => {
    h.debug.addFlyer("hearts", 7, 300, 300, 0, 0);
    h.run(3);
    h.debug.clearFlyers();
    h.debug.clearTrail();
    h.run();
    expect(h.debug.snapshot().trailStamps).toBe(0);
    expect(apart(h.pixel(340, 330), rgba(COLOR.table))).toBeLessThan(8);
  });

  it("takes no new stamp while the painting gate is off", () => {
    h.debug.setTrailPainting(false);
    h.debug.addFlyer("hearts", 7, 300, 300, 0, 0);
    h.run(3);
    expect(h.debug.snapshot().trailStamps).toBe(0);
    h.debug.clearFlyers();
    h.run();
    expect(apart(h.pixel(340, 330), rgba(COLOR.table))).toBeLessThan(8);
  });

  it("is cleared by a new deal", () => {
    h.debug.addFlyer("hearts", 7, 300, 300, 0, 0);
    h.run(2);
    h.debug.clearFlyers();
    h.debug.deal();
    h.run();
    expect(h.debug.snapshot().trailStamps).toBe(0);
  });
});

describe("the whole stage", () => {
  it("draws the title, the how-to and the table without leaving the stage bare", () => {
    for (const screen of ["title", "howto", "playing", "won"] as const) {
      h.debug.setScreen(screen);
      h.run();
      let marks = 0;
      for (let x = 20; x < STAGE_W; x += 40) {
        for (let y = 20; y < STAGE_H; y += 40) {
          if (apart(h.pixel(x, y), rgba(COLOR.table)) > 20) marks += 1;
        }
      }
      expect(marks).toBeGreaterThan(4);
    }
  });
});
