// Cascade — the build under the engine it ships on.
//
// Every other test here calls the game's own functions directly. This one stands
// the real engine up over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of
// its own, so `initialize`, `update`, and `render` run exactly as they do in a
// browser: the frames are stepped by a `ConstantClock`, the pointer is driven by
// dispatching pointer-shaped events at the engine's own event target, and the
// cues are read off the engine's `cue:played` events.
//
// The trail's offscreen surface is the one browser capability a Node host does
// not have, so the shim below hands `OffscreenCanvas` to the same node canvas the
// frame is drawn on. It is installed only if absent, so it never displaces a real
// host.

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { ConstantClock, createEngine } from "@test-cabinet/simple-2d";
import type { Engine } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  CUES,
  DEAL_MODE_LABEL,
  DECK_SIZE,
  FOUNDATION_X,
  HOWTO_BACK_LABEL,
  HUD_ITEMS,
  HUD_SOUND,
  LAUNCH_INTERVAL,
  RANK_MAX,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  SUITS,
  TABLEAU_Y,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_NEW_GAME,
  TITLE_TEXT,
  TOP_ROW_Y,
  TURN_COUNT,
  WASTE_X,
  WIN_TEXT,
} from "./constants";
import { BACKGROUND, game, type CascadeState } from "./game";
import type { CascadeDebugApi, CascadeSnapshot } from "./debug";

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

const STEP = 1 / 60;

interface Harness {
  engine: Engine<CascadeState, CascadeDebugApi>;
  debug: CascadeDebugApi;
  canvas: Canvas;
  cues: string[];
  snapshot(): CascadeSnapshot;
  apply(pose: (state: CascadeState) => CascadeState): void;
  pointer(type: string, x: number, y: number): void;
  advance(frames: number): Promise<void>;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

function createHarness(): Harness {
  const canvas: Canvas = createCanvas(STAGE_W, STAGE_H);
  const events = new EventTarget();
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    clock: new ConstantClock(1000 * STEP),
    surface: {
      cssWidth: () => STAGE_W,
      cssHeight: () => STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });

  const cues: string[] = [];
  engine.events.on("cue:played", (event) => cues.push(event.cue));

  return {
    engine,
    get debug() {
      return engine.debug;
    },
    canvas,
    cues,
    snapshot: () => engine.debug.snapshot(engine.state),
    apply(pose) {
      engine.apply((state) => pose(state as CascadeState));
    },
    pointer(type, x, y) {
      const event = new Event(type) as Event & {
        clientX: number;
        clientY: number;
        isPrimary: boolean;
      };
      Object.assign(event, { clientX: x, clientY: y, isPrimary: true });
      events.dispatchEvent(event);
    },
    advance: (frames) => engine.advance(frames),
    pixel(x, y) {
      const data = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
}

let h: Harness;

beforeEach(async () => {
  h = createHarness();
  await h.engine.initialize();
});

afterEach(() => {
  h.dispose();
});

/** One recording, flattened to the text runs the frames drew. */
interface Recorded {
  ops: readonly { op: string; method?: string; args?: readonly unknown[] }[];
  frames: readonly { ops: readonly number[] }[];
}

/** Every string the frames of a recording drew, in the order they drew them. */
function drawnText(recording: unknown): string[] {
  const rec = recording as Recorded;
  const out: string[] = [];
  for (const frame of rec.frames) {
    for (const index of frame.ops) {
      const op = rec.ops[index];
      if (op.op === "call" && op.method === "fillText") {
        out.push(String(op.args?.[0] ?? ""));
      }
    }
  }
  return out;
}

/** The strings one frame drew from where the game currently stands. */
async function textOfOneFrame(harness: Harness): Promise<string[]> {
  harness.engine.startRecording();
  await harness.advance(1);
  return drawnText(harness.engine.stopRecording());
}

/** A row across the table the seated flyers paint and no pile or HUD reaches. */
const FLOOR_ROW = 650;

/** The felt this build clears the frame to, as the frame reports it. */
const FELT = [20, 122, 82] as const;

/** The distance between two colors, out of 441. */
function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** An open table: reset, on the playing screen, with every pile empty. */
function open(harness: Harness): void {
  harness.apply((state) => harness.debug.reset(state));
  harness.apply((state) => harness.debug.setScreen(state, "playing"));
  harness.apply((state) => harness.debug.clearTable(state));
}

describe("the engine holds the game", () => {
  it("opens on the title screen with the surface in place", () => {
    expect(h.debug.version).toBe(1);
    expect(h.snapshot().screen).toBe("title");
  });

  it("advances game time on every screen", async () => {
    await h.advance(60);
    expect(h.snapshot().simTime).toBeCloseTo(1, 6);
  });

  it("advances on elapsed time alone, however the interval was divided", async () => {
    open(h);
    h.apply((s) => h.debug.setLaunching(s, false));
    h.apply((s) => h.debug.addFlyer(s, "spades", 5, 300, -4000, 200, 0));
    const before = h.snapshot();
    await h.advance(60);
    const fine = h.snapshot();

    const coarse = createHarness();
    await coarse.engine.initialize();
    coarse.engine.setClock(new ConstantClock(1000));
    open(coarse);
    coarse.apply((s) => coarse.debug.setLaunching(s, false));
    coarse.apply((s) =>
      coarse.debug.addFlyer(s, "spades", 5, 300, -4000, 200, 0),
    );
    await coarse.advance(1);
    const once = coarse.snapshot();
    coarse.dispose();

    expect(fine.simTime - before.simTime).toBeCloseTo(1, 6);
    expect(once.simTime).toBeCloseTo(1, 6);
    expect(once.flyers[0].x).toBeCloseTo(fine.flyers[0].x, 3);
  });
});

describe("the pointer the player uses", () => {
  it("deals and enters play from the title's control", async () => {
    h.pointer("pointerdown", TITLE_NEW_GAME.x + 100, TITLE_NEW_GAME.y + 20);
    h.pointer("pointerup", TITLE_NEW_GAME.x + 100, TITLE_NEW_GAME.y + 20);
    await h.advance(1);

    const snap = h.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(snap.stock).toHaveLength(24);
    expect(h.cues).toContain(CUES.deal);
  });

  it("turns the stock on a click", async () => {
    open(h);
    h.apply((s) => h.debug.addCard(s, "stock", 0, "hearts", 5, false));
    h.cues.length = 0;
    h.pointer("pointerdown", STOCK_X + 50, TOP_ROW_Y + 70);
    h.pointer("pointerup", STOCK_X + 50, TOP_ROW_Y + 70);
    await h.advance(1);

    expect(h.snapshot().waste).toHaveLength(TURN_COUNT);
    expect(h.cues).toEqual([CUES.turn]);
  });

  it("answers every sample a single frame delivered", async () => {
    open(h);
    h.apply((s) => h.debug.addCard(s, "foundation", 0, "hearts", 1, true));
    h.apply((s) => h.debug.addCard(s, "tableau", 1, "hearts", 2, true));
    h.cues.length = 0;

    h.pointer("pointerdown", COLUMN_X[1] + 50, TABLEAU_Y + 70);
    h.pointer("pointermove", FOUNDATION_X[0] + 50, TOP_ROW_Y + 70);
    h.pointer("pointerup", FOUNDATION_X[0] + 50, TOP_ROW_Y + 70);
    await h.advance(1);

    const snap = h.snapshot();
    expect(snap.foundations[0].map((c) => c.rank)).toEqual([1, 2]);
    expect(snap.tableau[1]).toEqual([]);
    expect(h.cues).toEqual([CUES.lift, CUES.drop, CUES.home]);
  });

  it("mutes and unmutes through the HUD, and a muted cue is silent", async () => {
    open(h);
    h.apply((s) => h.debug.addCard(s, "stock", 0, "hearts", 5, false));

    h.pointer("pointerdown", HUD_SOUND.x + 60, HUD_SOUND.y + 18);
    h.pointer("pointerup", HUD_SOUND.x + 60, HUD_SOUND.y + 18);
    await h.advance(1);
    expect(h.snapshot().muted).toBe(true);

    const gains: number[] = [];
    const off = h.engine.events.on("cue:played", (event) =>
      gains.push(event.gain),
    );
    h.pointer("pointerdown", STOCK_X + 50, TOP_ROW_Y + 70);
    h.pointer("pointerup", STOCK_X + 50, TOP_ROW_Y + 70);
    await h.advance(1);
    expect(gains).toEqual([0]);

    h.pointer("pointerdown", HUD_SOUND.x + 60, HUD_SOUND.y + 18);
    h.pointer("pointerup", HUD_SOUND.x + 60, HUD_SOUND.y + 18);
    await h.advance(1);
    expect(h.snapshot().muted).toBe(false);

    gains.length = 0;
    h.pointer("pointerdown", STOCK_X + 50, TOP_ROW_Y + 70);
    h.pointer("pointerup", STOCK_X + 50, TOP_ROW_Y + 70);
    await h.advance(1);
    expect(gains[0]).toBeGreaterThan(0);
    off();
  });
});

describe("the drawn table", () => {
  it("tells the cards, the backs, the slots and the felt apart", async () => {
    open(h);
    h.apply((s) => h.debug.addCard(s, "tableau", 0, "hearts", 7, true));
    h.apply((s) => h.debug.addCard(s, "tableau", 1, "spades", 7, true));
    h.apply((s) => h.debug.addCard(s, "tableau", 2, "clubs", 7, false));
    await h.advance(1);

    const felt = h.pixel(1200, 400);
    const red = h.pixel(COLUMN_X[0] + CARD_W / 2, TABLEAU_Y + CARD_H / 2);
    const black = h.pixel(COLUMN_X[1] + CARD_W / 2, TABLEAU_Y + CARD_H / 2);
    const back = h.pixel(COLUMN_X[2] + CARD_W / 2, TABLEAU_Y + CARD_H / 2);
    const slot = h.pixel(COLUMN_X[5] + CARD_W / 2, TABLEAU_Y + CARD_H / 2);

    expect(apart(red, black)).toBeGreaterThanOrEqual(90);
    expect(apart(back, black)).toBeGreaterThanOrEqual(90);
    expect(apart(back, red)).toBeGreaterThanOrEqual(90);
    expect(apart(back, felt)).toBeGreaterThanOrEqual(60);
    expect(apart(red, felt)).toBeGreaterThanOrEqual(90);
    expect(apart(black, felt)).toBeGreaterThanOrEqual(90);
    expect(apart(slot, felt)).toBeGreaterThanOrEqual(30);
  });

  it("draws a held run over the pile it passes over", async () => {
    open(h);
    h.apply((s) => h.debug.addCard(s, "tableau", 0, "clubs", 9, false));
    h.apply((s) => h.debug.addCard(s, "tableau", 1, "hearts", 7, true));
    h.pointer("pointerdown", COLUMN_X[1] + 50, TABLEAU_Y + 70);
    h.pointer("pointermove", COLUMN_X[0] + 50, TABLEAU_Y + 70);
    await h.advance(1);

    const held = h.pixel(COLUMN_X[0] + CARD_W / 2, TABLEAU_Y + CARD_H / 2);
    // The heart's centre pip, not the face-down card it is drawn over.
    expect(held[0]).toBeGreaterThan(150);
    expect(held[2]).toBeLessThan(100);
  });

  it("draws a highlighted target apart from the same pile bare", async () => {
    open(h);
    // Two cards, so the column's drop rectangle runs below the run held over it.
    h.apply((s) => h.debug.addCard(s, "tableau", 0, "clubs", 4, false));
    h.apply((s) => h.debug.addCard(s, "tableau", 0, "spades", 13, true));
    h.apply((s) => h.debug.addCard(s, "tableau", 1, "hearts", 12, true));
    await h.advance(1);
    const probe = { x: COLUMN_X[0] + 2, y: TABLEAU_Y + 160 };
    const bare = h.pixel(probe.x, probe.y);

    h.pointer("pointerdown", COLUMN_X[1] + 50, TABLEAU_Y + 70);
    h.pointer("pointermove", COLUMN_X[0] + 50, TABLEAU_Y + 70);
    await h.advance(1);
    expect(h.snapshot().dropTarget).toEqual({ pile: "tableau", index: 0 });
    expect(apart(bare, h.pixel(probe.x, probe.y))).toBeGreaterThanOrEqual(60);
  });
});

describe("the victory cascade", () => {
  async function win(): Promise<void> {
    open(h);
    for (let f = 0; f < 4; f++) {
      for (let r = 1; r <= RANK_MAX; r++) {
        if (f === 0 && r === RANK_MAX) continue;
        h.apply((s) => h.debug.addCard(s, "foundation", f, SUITS[f], r, true));
      }
    }
    h.apply((s) => h.debug.addCard(s, "tableau", 0, SUITS[0], RANK_MAX, true));
    h.pointer("pointerdown", COLUMN_X[0] + 50, TABLEAU_Y + 70);
    h.pointer("pointermove", FOUNDATION_X[0] + 50, TOP_ROW_Y + 70);
    h.pointer("pointerup", FOUNDATION_X[0] + 50, TOP_ROW_Y + 70);
    await h.advance(1);
  }

  it("begins with the win and launches on its first frame", async () => {
    h.cues.length = 0;
    await win();
    const snap = h.snapshot();
    expect(snap.screen).toBe("won");
    expect(snap.launched).toBe(1);
    expect(snap.flyers[0]).toMatchObject({
      x: FOUNDATION_X[0],
      y: TOP_ROW_Y,
      vy: -120,
    });
    expect(h.cues).toContain(CUES.win);
    expect(h.cues).toContain(CUES.launch);
    expect(snap.launchClock).toBeCloseTo(STEP, 6);
    expect(LAUNCH_INTERVAL).toBe(0.18);
  });

  /** How much of a row of the table is no longer bare felt. */
  function paintedAcross(y: number): number {
    let painted = 0;
    for (let x = 20; x < STAGE_W; x += 20) {
      if (apart(h.pixel(x, y), FELT) > 40) painted++;
    }
    return painted;
  }

  it("buries the table under a trail that stays painted", async () => {
    await win();
    await h.advance(60 * 3);
    const early = h.snapshot().trailStamps;
    expect(early).toBeGreaterThan(0);
    const painted = paintedAcross(FLOOR_ROW);
    expect(painted).toBeGreaterThan(3);

    await h.advance(60 * 3);
    expect(h.snapshot().trailStamps).toBeGreaterThan(early);
    expect(paintedAcross(FLOOR_ROW)).toBeGreaterThanOrEqual(painted);
  });

  it("launches every card and reports itself done", async () => {
    await win();
    h.apply((s) => h.debug.setTrailPainting(s, false));
    await h.advance(60 * 16);
    const snap = h.snapshot();
    expect(snap.launched).toBe(DECK_SIZE);
    expect(snap.flyers).toEqual([]);
    expect(snap.cascadeDone).toBe(true);
    expect(snap.foundations.every((pile) => pile.length === 0)).toBe(true);
  });

  it("deals a fresh game on a press, clearing the painted table", async () => {
    await win();
    await h.advance(60 * 2);
    expect(h.snapshot().trailStamps).toBeGreaterThan(0);

    h.pointer("pointerdown", 640, 360);
    await h.advance(1);
    const snap = h.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.trailStamps).toBe(0);
    expect(snap.stock).toHaveLength(24);
    expect(paintedAcross(FLOOR_ROW)).toBe(0);
  });
});

describe("the screens", () => {
  it("draws the title, the tagline, the deal mode and both items", async () => {
    const text = await textOfOneFrame(h);
    expect(text).toContain(TITLE_TEXT);
    expect(text).toContain(TAGLINE_TEXT);
    expect(text).toContain(DEAL_MODE_LABEL);
    expect(text).toContain(TITLE_ITEMS[0]);
    expect(text).toContain(TITLE_ITEMS[1]);
  });

  it("carries every token the how-to screen must name", async () => {
    h.apply((s) => h.debug.setScreen(s, "howto"));
    const prose = (await textOfOneFrame(h)).join(" ");
    for (const token of ["ACE", "KING", "STOCK", "DOUBLE-CLICK"]) {
      expect(new RegExp(`\\b${token}\\b`).test(prose)).toBe(true);
    }
    expect(prose).toContain(HOWTO_BACK_LABEL);
  });

  it("draws the HUD's three labels and the deal mode during play", async () => {
    open(h);
    const text = await textOfOneFrame(h);
    for (const label of HUD_ITEMS) expect(text).toContain(label);
    expect(text).toContain(DEAL_MODE_LABEL);
  });

  it("draws every one of the thirteen piles on a dealt table", async () => {
    open(h);
    h.apply((s) => h.debug.deal(s));
    await h.advance(1);
    // Each pile draws either a card or its empty slot at its anchor.
    for (const [x, y] of [
      [STOCK_X, TOP_ROW_Y],
      [WASTE_X, TOP_ROW_Y],
      ...FOUNDATION_X.map((fx) => [fx, TOP_ROW_Y]),
      ...COLUMN_X.map((cx) => [cx, TABLEAU_Y]),
    ]) {
      expect(
        apart(h.pixel(x + CARD_W / 2, y + CARD_H / 2), FELT),
      ).toBeGreaterThan(30);
    }
  });

  it("draws its message once the cascade is done", async () => {
    open(h);
    h.apply((s) => h.debug.setScreen(s, "won"));
    expect(await textOfOneFrame(h)).not.toContain(WIN_TEXT);
    h.apply((s) => ({ ...s, cascadeDone: true }));
    expect(await textOfOneFrame(h)).toContain(WIN_TEXT);
  });
});
