// What one frame draws, read off a real 2D context.
//
// The engine hands `render` a context that is already cleared to BACKGROUND and
// already carrying the logical transform, so these checks stand a canvas of the
// stage's own size up, clear it the way the engine does, and call `renderGame`
// through a proxy that records the text runs and the image draws it made.

import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { NO_SPRITES, type SnakeSprites } from "./assets";
import { cellX, cellY } from "./board";
import {
  BEST_LABEL,
  BOARD_Y,
  CELL,
  CLEARED_TEXT,
  GAMEOVER_TEXT,
  HEAD_FRAMES,
  MODE_LABEL,
  SCORE_LABEL,
  SPRITE_PATHS,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_TEXT,
  type Cell,
} from "./constants";
import {
  BACKGROUND,
  createInitialState,
  startRound,
  goTo,
  type CoilState,
} from "./game";
import { renderGame } from "./render";

let sprites: SnakeSprites;

beforeAll(async () => {
  const load = async (path: string): Promise<ImageBitmap> =>
    (await loadImage(
      new URL(`../assets/${path}`, import.meta.url).pathname,
    )) as unknown as ImageBitmap;
  sprites = {
    head: await Promise.all(SPRITE_PATHS.head.map(load)),
    body: await load(SPRITE_PATHS.body),
    corner: await load(SPRITE_PATHS.corner),
    tail: await load(SPRITE_PATHS.tail),
  };
});

/** The text and image draws one frame made, alongside the pixels it painted. */
interface Frame {
  canvas: Canvas;
  texts: { value: string; x: number; y: number }[];
  images: { source: unknown; x: number; y: number }[];
  smoothing: boolean[];
}

function draw(state: CoilState): Frame {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const real = canvas.getContext("2d");
  // Exactly what the engine does before it calls `render`.
  real.fillStyle = BACKGROUND;
  real.fillRect(0, 0, STAGE_W, STAGE_H);

  const texts: Frame["texts"] = [];
  const images: Frame["images"] = [];
  const smoothing: boolean[] = [];
  const recorder = new Proxy(real, {
    get(target, key) {
      if (key === "fillText") {
        return (value: string, x: number, y: number): void => {
          texts.push({ value, x, y });
          target.fillText(value, x, y);
        };
      }
      if (key === "drawImage") {
        return (source: unknown, ...rest: number[]): void => {
          // Every sprite is drawn about a translated origin, so the transform's
          // own offset is the cell center the sprite landed on.
          const matrix = target.getTransform();
          images.push({ source, x: matrix.e, y: matrix.f });
          smoothing.push(target.imageSmoothingEnabled);
          (target.drawImage as (...args: unknown[]) => void)(source, ...rest);
        };
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) {
      return Reflect.set(target, key, value);
    },
  }) as unknown as CanvasRenderingContext2D;
  renderGame(state, recorder);
  return { canvas, texts, images, smoothing };
}

function pixelAt(frame: Frame, cell: Cell): [number, number, number] {
  const data = frame.canvas
    .getContext("2d")
    .getImageData(
      Math.round(cellX(cell.col) + CELL / 2),
      Math.round(cellY(cell.row) + CELL / 2),
      1,
      1,
    ).data;
  return [data[0]!, data[1]!, data[2]!];
}

function distance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The threshold the specification's visibility requirements are read against. */
const APART = 50;

/** A live round with a straight run, a bend and a tail, and a pellet clear of it. */
function playing(over: Partial<CoilState> = {}): CoilState {
  const state = startRound({
    ...createInitialState(sprites, false),
    sprites,
  });
  return {
    ...state,
    snake: [
      { col: 12, row: 8 },
      { col: 11, row: 8 },
      { col: 10, row: 8 },
      { col: 10, row: 9 },
      { col: 10, row: 10 },
    ],
    dir: "right",
    pellet: { col: 20, row: 4 },
    obstacles: [],
    ...over,
  };
}

describe("the board", () => {
  it("tells the wall border apart from the interior", () => {
    const frame = draw(playing());
    expect(
      distance(
        pixelAt(frame, { col: 0, row: 8 }),
        pixelAt(frame, { col: 5, row: 5 }),
      ),
    ).toBeGreaterThan(20);
  });

  it("tells the head apart from the field and from the body", () => {
    const frame = draw(playing());
    const head = pixelAt(frame, { col: 12, row: 8 });
    const body = pixelAt(frame, { col: 11, row: 8 });
    const field = pixelAt(frame, { col: 22, row: 12 });
    expect(distance(head, field)).toBeGreaterThan(APART);
    expect(distance(head, body)).toBeGreaterThan(20);
  });

  it("tells the pellet apart from the field, the head and the body", () => {
    const frame = draw(playing());
    const pellet = pixelAt(frame, { col: 20, row: 4 });
    expect(
      distance(pellet, pixelAt(frame, { col: 22, row: 12 })),
    ).toBeGreaterThan(APART);
    expect(
      distance(pellet, pixelAt(frame, { col: 12, row: 8 })),
    ).toBeGreaterThan(APART);
    expect(
      distance(pellet, pixelAt(frame, { col: 11, row: 8 })),
    ).toBeGreaterThan(APART);
  });

  it("tells an obstacle cell apart from the field, the wall and the snake", () => {
    const frame = draw(playing({ obstacles: [{ col: 18, row: 12 }] }));
    const obstacle = pixelAt(frame, { col: 18, row: 12 });
    expect(
      distance(obstacle, pixelAt(frame, { col: 22, row: 12 })),
    ).toBeGreaterThan(APART);
    expect(
      distance(obstacle, pixelAt(frame, { col: 0, row: 12 })),
    ).toBeGreaterThan(APART);
    expect(
      distance(obstacle, pixelAt(frame, { col: 11, row: 8 })),
    ).toBeGreaterThan(APART);
  });
});

describe("the snake's sprites", () => {
  it("paints the head and every body cell with an image draw", () => {
    const frame = draw(playing());
    expect(frame.images.length).toBe(5);
    const centres = frame.images.map((image) => `${image.x},${image.y}`);
    for (const cell of playing().snake) {
      expect(centres).toContain(
        `${cellX(cell.col) + CELL / 2},${cellY(cell.row) + CELL / 2}`,
      );
    }
  });

  it("draws the straight, corner and tail sprites where each belongs", () => {
    const frame = draw(playing());
    const at = (cell: Cell): unknown =>
      frame.images.find(
        (image) =>
          image.x === cellX(cell.col) + CELL / 2 &&
          image.y === cellY(cell.row) + CELL / 2,
      )?.source;
    expect(at({ col: 12, row: 8 })).toBe(sprites.head[0]);
    expect(at({ col: 11, row: 8 })).toBe(sprites.body);
    expect(at({ col: 10, row: 8 })).toBe(sprites.corner);
    expect(at({ col: 10, row: 10 })).toBe(sprites.tail);
  });

  it("paints every sprite with smoothing off", () => {
    const frame = draw(playing());
    expect(frame.smoothing.length).toBeGreaterThan(0);
    expect(frame.smoothing.every((on) => on === false)).toBe(true);
  });

  it("paints the bite's frame while a bite is playing", () => {
    for (let frameIndex = 1; frameIndex < HEAD_FRAMES; frameIndex++) {
      // biteRemaining counts down, so frame 1 is drawn near the start of it.
      const remaining = 0.25 * (1 - (frameIndex - 0.5) / 3);
      const frame = draw(playing({ biteRemaining: remaining }));
      const head = frame.images.find(
        (image) =>
          image.x === cellX(12) + CELL / 2 && image.y === cellY(8) + CELL / 2,
      );
      expect(head?.source).toBe(sprites.head[frameIndex]);
    }
  });

  it("still draws a legible board when no sprite arrived", () => {
    const frame = draw(playing({ sprites: NO_SPRITES }));
    expect(frame.images.length).toBe(0);
    expect(
      distance(
        pixelAt(frame, { col: 12, row: 8 }),
        pixelAt(frame, { col: 22, row: 12 }),
      ),
    ).toBeGreaterThan(20);
  });
});

describe("the HUD", () => {
  it("draws the score, the best and the mode inside the band above the board", () => {
    const frame = draw(playing({ score: 240, best: 900 }));
    const shown = frame.texts.map((run) => run.value);
    expect(shown).toContain(SCORE_LABEL);
    expect(shown).toContain(BEST_LABEL);
    expect(shown).toContain(MODE_LABEL);
    expect(shown).toContain("240");
    expect(shown).toContain("900");
    for (const label of [SCORE_LABEL, BEST_LABEL, MODE_LABEL]) {
      const run = frame.texts.find((entry) => entry.value === label)!;
      expect(run.y).toBeLessThan(BOARD_Y);
    }
  });

  it("draws no multiplier at an M of 1", () => {
    const frame = draw(playing({ combo: 1, comboWindow: 0 }));
    expect(frame.texts.map((run) => run.value)).not.toContain("x1");
  });

  it("draws the multiplier from an M of 2 upward", () => {
    for (const combo of [2, 3, 4, 5]) {
      const frame = draw(playing({ combo, comboWindow: 2 }));
      expect(frame.texts.map((run) => run.value)).toContain(`x${combo}`);
    }
  });

  it("draws a different band muted than unmuted", () => {
    const loud = draw(playing({ muted: false })).texts.map((run) => run.value);
    const quiet = draw(playing({ muted: true })).texts.map((run) => run.value);
    expect(quiet).not.toEqual(loud);
  });
});

describe("the screens", () => {
  it("draws the title copy", () => {
    const shown = draw({
      ...createInitialState(sprites, false),
      best: 120,
    }).texts.map((run) => run.value);
    expect(shown).toContain(TITLE_TEXT);
    expect(shown).toContain(TAGLINE_TEXT);
    expect(shown).toContain(BEST_LABEL);
    expect(shown).toContain("120");
  });

  it("names the steering keys on how to play", () => {
    const shown = draw(goTo(createInitialState(sprites, false), "howto"))
      .texts.map((run) => run.value)
      .join(" ");
    for (const code of [
      "ArrowUp",
      "KeyW",
      "ArrowDown",
      "KeyS",
      "ArrowLeft",
      "KeyA",
      "ArrowRight",
      "KeyD",
      "Enter",
      "Space",
      "Escape",
      "KeyP",
      "KeyM",
    ]) {
      expect(shown).toContain(code);
    }
  });

  it("draws the pause menu over the board", () => {
    const frame = draw(playing({ screen: "paused" }));
    const shown = frame.texts.map((run) => run.value);
    expect(shown).toContain("RESUME");
    expect(shown).toContain("RESTART");
    expect(shown).toContain("MENU");
    // The board is still behind the panel.
    expect(frame.images.length).toBeGreaterThan(0);
  });

  it("draws the game-over copy", () => {
    const shown = draw(playing({ screen: "gameover", score: 70 })).texts.map(
      (run) => run.value,
    );
    expect(shown).toContain(GAMEOVER_TEXT);
    expect(shown).toContain("PLAY AGAIN");
    expect(shown).toContain("70");
  });

  it("draws the cleared heading in place of the game-over one", () => {
    const shown = draw(playing({ screen: "cleared" })).texts.map(
      (run) => run.value,
    );
    expect(shown).toContain(CLEARED_TEXT);
    expect(shown).not.toContain(GAMEOVER_TEXT);
  });
});

describe("the stage", () => {
  it("draws nothing outside the fixed logical stage", () => {
    expect(STAGE_W).toBe(1280);
    expect(STAGE_H).toBe(720);
    const frame = draw(playing());
    for (const run of frame.texts) {
      expect(run.x).toBeGreaterThanOrEqual(0);
      expect(run.x).toBeLessThanOrEqual(STAGE_W);
      expect(run.y).toBeGreaterThanOrEqual(0);
      expect(run.y).toBeLessThanOrEqual(STAGE_H);
    }
  });
});
