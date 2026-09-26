import { describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  DEAL_MODE_LABEL,
  FOUNDATION_X,
  HOWTO_BACK,
  HOWTO_TOKENS,
  HUD_H,
  HUD_ITEMS,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  HUD_Y,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  TABLEAU_Y,
  TAGLINE_TEXT,
  TITLE_HOW_TO,
  TITLE_ITEMS,
  TITLE_NEW_GAME,
  TITLE_TEXT,
  TOP_ROW_Y,
  WASTE_X,
  WIN_TEXT,
} from "./constants";
import { drawCardOn, drawSlot } from "./cards";
import { put, stageContext, testState } from "./harness.test-support";
import { render } from "./render";
import type { CascadeState } from "./state";
import type { Card, Rect } from "./types";

/** The RGB distance between two samples, out of the 441 the space allows. */
function distance(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Draw one frame and hand back a pixel reader over it. */
function frame(state: CascadeState) {
  const surface = stageContext();
  render(state, surface.ctx);
  return surface;
}

/** Every run of text one screen draws, collected off a recording context. */
function textOf(state: CascadeState): { text: string; x: number; y: number }[] {
  const runs: { text: string; x: number; y: number }[] = [];
  const surface = stageContext();
  const ctx = surface.ctx;
  const original = ctx.fillText.bind(ctx);
  ctx.fillText = (text: string, x: number, y: number): void => {
    runs.push({ text, x, y });
    original(text, x, y);
  };
  render(state, ctx);
  return runs;
}

function playing(): CascadeState {
  const state = testState();
  state.screen = "playing";
  return state;
}

function inside(runs: { x: number; y: number }[], rect: Rect): boolean {
  return runs.some(
    (run) =>
      run.x >= rect.x &&
      run.x <= rect.x + rect.w &&
      run.y >= rect.y &&
      run.y <= rect.y + rect.h,
  );
}

describe("a card", () => {
  const card: Card = { id: 1, suit: "hearts", rank: 7, faceUp: true };

  it("covers its whole footprint wherever it sits", () => {
    const { ctx, pixel } = stageContext();
    ctx.fillStyle = "#1a7a4a";
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    const felt = pixel(5, 5);
    drawCardOn(ctx, card, 200, 100);
    for (const [x, y] of [
      [200, 100],
      [200 + CARD_W - 1, 100],
      [200, 100 + CARD_H - 1],
      [200 + CARD_W - 1, 100 + CARD_H - 1],
      [200 + CARD_W / 2, 100 + CARD_H / 2],
    ]) {
      expect(distance(pixel(x, y), felt)).toBeGreaterThan(30);
    }
    // And nothing outside it.
    expect(distance(pixel(199, 100), felt)).toBe(0);
    expect(distance(pixel(200, 99), felt)).toBe(0);
  });

  it("draws its rank and its suit on itself", () => {
    const runs: string[] = [];
    const { ctx } = stageContext();
    const original = ctx.fillText.bind(ctx);
    ctx.fillText = (text: string, x: number, y: number): void => {
      runs.push(text);
      original(text, x, y);
    };
    drawCardOn(ctx, { id: 1, suit: "diamonds", rank: 10, faceUp: true }, 0, 0);
    expect(runs).toContain("10");
    expect(runs).toContain("♦");
  });

  it("tells red from black, a face from a back, and both from the table", () => {
    const { ctx, pixel } = stageContext();
    ctx.fillStyle = "#1a7a4a";
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    const felt = pixel(5, 5);

    drawCardOn(ctx, { id: 1, suit: "hearts", rank: 5, faceUp: true }, 0, 0);
    drawCardOn(ctx, { id: 2, suit: "spades", rank: 5, faceUp: true }, 200, 0);
    drawCardOn(ctx, { id: 3, suit: "spades", rank: 5, faceUp: false }, 400, 0);

    const heartPip = pixel(CARD_W / 2, CARD_H / 2 + 4);
    const spadePip = pixel(200 + CARD_W / 2, CARD_H / 2 + 4);
    const face = pixel(50, 130);
    const back = pixel(450, 70);

    expect(distance(heartPip, spadePip)).toBeGreaterThanOrEqual(90);
    expect(distance(back, face)).toBeGreaterThanOrEqual(90);
    expect(distance(back, felt)).toBeGreaterThanOrEqual(60);
    expect(distance(face, felt)).toBeGreaterThanOrEqual(90);
  });

  it("marks an empty slot apart from the bare table", () => {
    const { ctx, pixel } = stageContext();
    ctx.fillStyle = "#1a7a4a";
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    const felt = pixel(5, 5);
    drawSlot(ctx, 300, 300);
    expect(
      distance(pixel(300 + CARD_W / 2, 300 + 20), felt),
    ).toBeGreaterThanOrEqual(30);
  });
});

describe("the live table", () => {
  it("draws every one of the thirteen piles", () => {
    const state = playing();
    put(state, "stock", 0, "spades", 3, false);
    put(state, "waste", 0, "hearts", 4);
    state.wasteSets.push(1);
    for (let i = 0; i < 4; i += 1) put(state, "foundation", i, "clubs", 1);
    for (let i = 0; i < 7; i += 1) put(state, "tableau", i, "diamonds", 6);
    const { pixel } = frame(state);
    const felt: [number, number, number] = [26, 122, 74];
    expect(distance(pixel(STOCK_X + 50, TOP_ROW_Y + 70), felt)).toBeGreaterThan(
      30,
    );
    expect(distance(pixel(WASTE_X + 50, TOP_ROW_Y + 70), felt)).toBeGreaterThan(
      30,
    );
    for (const x of FOUNDATION_X) {
      expect(distance(pixel(x + 50, TOP_ROW_Y + 70), felt)).toBeGreaterThan(30);
    }
    for (const x of COLUMN_X) {
      expect(distance(pixel(x + 50, TABLEAU_Y + 70), felt)).toBeGreaterThan(30);
    }
  });

  it("shows the waste's card at the anchor with the earlier ones squared beneath", () => {
    const state = playing();
    for (let i = 1; i <= 3; i += 1) {
      put(state, "waste", 0, "hearts", i);
      state.wasteSets.push(1);
    }
    const runs = textOf(state);
    // The waste's top card is the last one drawn there, so its rank is on top.
    const onWaste = runs.filter(
      (run) => run.x >= WASTE_X && run.x <= WASTE_X + CARD_W,
    );
    expect(onWaste.some((run) => run.text === "3")).toBe(true);
    expect(onWaste.some((run) => run.text === "A")).toBe(true);
  });

  it("draws an empty-slot mark on a waste holding cards with no sets", () => {
    const state = playing();
    put(state, "waste", 0, "hearts", 9);
    const runs = textOf(state);
    expect(
      runs.some(
        (run) =>
          run.x >= WASTE_X && run.x <= WASTE_X + CARD_W && run.text === "9",
      ),
    ).toBe(false);
  });

  it("draws a held run over the pile it passes over", () => {
    const state = playing();
    put(state, "tableau", 0, "spades", 13);
    const held = put(state, "tableau", 1, "hearts", 12);
    state.tableau[1].length = 0;
    state.drag = {
      cards: [held],
      fromPile: "tableau",
      fromIndex: 1,
      x: COLUMN_X[0],
      y: TABLEAU_Y,
      grabDX: 0,
      grabDY: 0,
    };
    const { pixel } = frame(state);
    const heartPip = pixel(
      COLUMN_X[0] + CARD_W / 2,
      TABLEAU_Y + CARD_H / 2 + 4,
    );
    // The run in hand is a red Queen, so the pip under it is red rather than
    // the black King's.
    expect(heartPip[0]).toBeGreaterThan(heartPip[2]);
  });

  it("marks a highlighted target apart from the same pile unmarked", () => {
    const state = playing();
    put(state, "tableau", 0, "spades", 13);
    const plain = frame(state);
    state.dropTarget = { pile: "tableau", index: 0 };
    const marked = frame(state);
    let best = 0;
    for (let y = TABLEAU_Y; y < TABLEAU_Y + CARD_H; y += 4) {
      for (let x = COLUMN_X[0]; x < COLUMN_X[0] + CARD_W; x += 4) {
        best = Math.max(best, distance(plain.pixel(x, y), marked.pixel(x, y)));
      }
    }
    expect(best).toBeGreaterThanOrEqual(60);
  });

  it("keeps the HUD in its strip and puts every label inside its rectangle", () => {
    const state = playing();
    const runs = textOf(state);
    expect(inside(runs, HUD_NEW_GAME)).toBe(true);
    expect(inside(runs, HUD_MENU)).toBe(true);
    expect(inside(runs, HUD_SOUND)).toBe(true);
    for (const label of HUD_ITEMS) {
      expect(runs.some((run) => run.text === label)).toBe(true);
    }
    expect(runs.some((run) => run.text === DEAL_MODE_LABEL)).toBe(true);
    for (const rect of [HUD_NEW_GAME, HUD_MENU, HUD_SOUND]) {
      expect(rect.y).toBeGreaterThanOrEqual(HUD_Y);
      expect(rect.y + rect.h).toBeLessThanOrEqual(HUD_Y + HUD_H);
    }
  });
});

describe("the screens", () => {
  it("draws the title, the tagline, both items and the deal-mode label", () => {
    const state = testState();
    const runs = textOf(state);
    const texts = runs.map((run) => run.text);
    expect(texts).toContain(TITLE_TEXT);
    expect(texts).toContain(TAGLINE_TEXT);
    expect(texts).toContain(TITLE_ITEMS[0]);
    expect(texts).toContain(TITLE_ITEMS[1]);
    expect(texts).toContain(DEAL_MODE_LABEL);
    expect(inside(runs, TITLE_NEW_GAME)).toBe(true);
    expect(inside(runs, TITLE_HOW_TO)).toBe(true);
  });

  it("reads every title string against what sits immediately behind it", () => {
    const state = testState();
    const { pixel } = frame(state);
    // The title, the tagline and the deal-mode badge sit on the quieted table
    // or on a plate; each control's label sits on its own plate. Both inks are
    // read against both grounds.
    const inks: [number, number, number][] = [
      [246, 251, 247],
      [205, 234, 219],
      [255, 213, 74],
    ];
    const grounds = [
      pixel(30, 30),
      pixel(TITLE_NEW_GAME.x + 3, TITLE_NEW_GAME.y + 3),
      pixel(TITLE_HOW_TO.x + 3, TITLE_HOW_TO.y + 3),
    ];
    for (const ink of inks) {
      for (const ground of grounds) {
        expect(distance(ink, ground)).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it("carries each of the how-to tokens as a standalone word, and a way back", () => {
    const state = testState();
    state.screen = "howto";
    const runs = textOf(state);
    const copy = runs.map((run) => run.text).join(" ");
    for (const token of HOWTO_TOKENS) {
      expect(copy).toMatch(new RegExp(`\\b${token}\\b`));
    }
    expect(inside(runs, HOWTO_BACK)).toBe(true);
  });

  it("shows the win message only once the cascade is done", () => {
    const state = testState();
    state.screen = "won";
    expect(textOf(state).map((run) => run.text)).not.toContain(WIN_TEXT);
    state.cascadeDone = true;
    expect(textOf(state).map((run) => run.text)).toContain(WIN_TEXT);
  });

  it("keeps drawing the cards still on the foundations while the cascade runs", () => {
    const state = testState();
    state.screen = "won";
    put(state, "foundation", 1, "spades", 13);
    const runs = textOf(state);
    expect(
      runs.some(
        (run) =>
          run.text === "K" &&
          run.x >= FOUNDATION_X[1] &&
          run.x <= FOUNDATION_X[1] + CARD_W,
      ),
    ).toBe(true);
  });
});
