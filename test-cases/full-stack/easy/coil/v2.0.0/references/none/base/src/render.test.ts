import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import type { Assets } from "./assets";
import {
  BOARD_Y,
  CELL,
  HEAD_FRAMES,
  STAGE_H,
  STAGE_W,
  cellX,
  cellY,
  type Cell,
  type Cue,
} from "./constants";
import { Game, type AudioBus } from "./game";
import { render } from "./render";

class SilentBus implements AudioBus {
  muted = false;
  play(_cue: Cue): void {}
  startLoop(_cue: Cue): void {}
  stopLoop(_cue: Cue): void {}
  toggleMute(): void {
    this.muted = !this.muted;
  }
}

let assets: Assets;

beforeAll(async () => {
  const load = async (path: string): Promise<HTMLImageElement> =>
    (await loadImage(
      new URL(path, import.meta.url).pathname,
    )) as unknown as HTMLImageElement;
  const head: HTMLImageElement[] = [];
  for (let frame = 0; frame < HEAD_FRAMES; frame++) {
    head.push(await load(`../assets/snake/head/${frame}.png`));
  }
  assets = {
    snake: {
      head,
      body: await load("../assets/snake/body.png"),
      corner: await load("../assets/snake/corner.png"),
      tail: await load("../assets/snake/tail.png"),
    },
    audio: { eat: null, "combo-up": null, death: null, music: null },
  };
});

/** The text and image draws one frame made, alongside the pixels it painted. */
interface Frame {
  canvas: Canvas;
  texts: { value: string; x: number; y: number }[];
  images: { source: unknown; x: number; y: number }[];
  smoothing: boolean[];
}

function draw(game: Game, biteFrame = 0): Frame {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const real = canvas.getContext("2d");
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
  render(recorder, game, assets, { time: 0, biteFrame });
  return { canvas, texts, images, smoothing };
}

function pixelAt(frame: Frame, cell: Cell): [number, number, number] {
  const ctx = frame.canvas.getContext("2d");
  const data = ctx.getImageData(
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

function playing(): Game {
  const game = new Game(new SilentBus());
  game.startRound();
  game.sim.setSnake([
    { col: 10, row: 8 },
    { col: 9, row: 8 },
    { col: 8, row: 8 },
    { col: 8, row: 9 },
    { col: 8, row: 10 },
  ]);
  game.sim.dir = "right";
  game.sim.setPellet(20, 4);
  return game;
}

describe("the board", () => {
  it("tells the wall border apart from the interior", () => {
    const frame = draw(playing());
    const wall = pixelAt(frame, { col: 0, row: 0 });
    const empty = pixelAt(frame, { col: 25, row: 12 });
    expect(distance(wall, empty)).toBeGreaterThan(APART);
  });

  it("tells the head apart from the field and from the body", () => {
    const frame = draw(playing());
    const head = pixelAt(frame, { col: 10, row: 8 });
    const body = pixelAt(frame, { col: 9, row: 8 });
    const empty = pixelAt(frame, { col: 25, row: 12 });
    expect(distance(head, empty)).toBeGreaterThan(APART);
    expect(distance(head, body)).toBeGreaterThan(APART);
  });

  it("tells the pellet apart from the field, the head and the body", () => {
    const frame = draw(playing());
    const pellet = pixelAt(frame, { col: 20, row: 4 });
    expect(
      distance(pellet, pixelAt(frame, { col: 25, row: 12 })),
    ).toBeGreaterThan(APART);
    expect(
      distance(pellet, pixelAt(frame, { col: 10, row: 8 })),
    ).toBeGreaterThan(APART);
    expect(
      distance(pellet, pixelAt(frame, { col: 9, row: 8 })),
    ).toBeGreaterThan(APART);
  });

  it("tells an obstacle cell apart from the field, the wall and the snake", () => {
    const game = playing();
    game.sim.addObstacle(20, 10);
    const frame = draw(game);
    const obstacle = pixelAt(frame, { col: 20, row: 10 });
    expect(
      distance(obstacle, pixelAt(frame, { col: 25, row: 12 })),
    ).toBeGreaterThan(APART);
    expect(
      distance(obstacle, pixelAt(frame, { col: 0, row: 0 })),
    ).toBeGreaterThan(APART);
    expect(
      distance(obstacle, pixelAt(frame, { col: 10, row: 8 })),
    ).toBeGreaterThan(APART);
    expect(
      distance(obstacle, pixelAt(frame, { col: 9, row: 8 })),
    ).toBeGreaterThan(APART);
  });
});

describe("the snake's sprites", () => {
  it("paints the head and the body cells with image draws", () => {
    const frame = draw(playing());
    const at = (cell: Cell): unknown =>
      frame.images.find(
        (image) =>
          Math.abs(image.x - (cellX(cell.col) + CELL / 2)) < 1 &&
          Math.abs(image.y - (cellY(cell.row) + CELL / 2)) < 1,
      )?.source;
    expect(at({ col: 10, row: 8 })).toBe(assets.snake.head[0]);
    expect(at({ col: 9, row: 8 })).toBe(assets.snake.body);
    expect(at({ col: 8, row: 8 })).toBe(assets.snake.corner);
    expect(at({ col: 8, row: 10 })).toBe(assets.snake.tail);
  });

  it("paints every sprite with smoothing off", () => {
    const frame = draw(playing());
    expect(frame.smoothing.length).toBeGreaterThan(0);
    expect(frame.smoothing.every((value) => value === false)).toBe(true);
  });

  it("paints the bite's frame while a bite is playing", () => {
    const game = playing();
    const frame = draw(game, 2);
    const head = frame.images.find(
      (image) =>
        Math.abs(image.x - (cellX(10) + CELL / 2)) < 1 &&
        Math.abs(image.y - (cellY(8) + CELL / 2)) < 1,
    );
    expect(head?.source).toBe(assets.snake.head[2]);
  });
});

describe("the HUD", () => {
  it("draws the score, the best and the mode inside the band above the board", () => {
    const game = playing();
    game.sim.score = 240;
    game.best = 990;
    const frame = draw(game);
    const values = frame.texts.map((entry) => entry.value);
    expect(values).toContain("SCORE");
    expect(values).toContain("240");
    expect(values).toContain("BEST");
    expect(values).toContain("990");
    for (const entry of frame.texts) {
      expect(entry.y).toBeLessThan(BOARD_Y);
    }
  });

  it("draws no multiplier at an M of 1", () => {
    const frame = draw(playing());
    for (const entry of frame.texts) {
      expect(entry.value).not.toMatch(/^x[2-5]$/);
    }
  });

  it("draws the multiplier from an M of 2 upward", () => {
    const game = playing();
    game.sim.combo = 3;
    game.sim.comboWindow = 2;
    const frame = draw(game);
    expect(frame.texts.map((entry) => entry.value)).toContain("x3");
  });

  it("draws a different band muted than unmuted", () => {
    const game = playing();
    const loud = draw(game)
      .texts.map((entry) => entry.value)
      .join("|");
    game.muted = true;
    const quiet = draw(game)
      .texts.map((entry) => entry.value)
      .join("|");
    expect(quiet).not.toBe(loud);
  });
});

describe("the screens", () => {
  it("draws the title copy", () => {
    const game = new Game(new SilentBus());
    const values = draw(game).texts.map((entry) => entry.value);
    expect(values).toContain("COIL");
    expect(values).toContain("GRID SERPENT");
    expect(values).toContain("BEST");
    expect(values).toContain("HOW TO PLAY");
  });

  it("names the steering keys on how to play", () => {
    const game = new Game(new SilentBus());
    game.goTo("howto");
    const copy = draw(game)
      .texts.map((entry) => entry.value)
      .join(" ");
    for (const key of [
      "ArrowUp",
      "KeyW",
      "ArrowLeft",
      "KeyD",
      "Enter",
      "Escape",
    ]) {
      expect(copy).toContain(key);
    }
  });

  it("draws the pause menu", () => {
    const game = playing();
    game.goTo("paused");
    const values = draw(game).texts.map((entry) => entry.value);
    for (const item of ["RESUME", "RESTART", "MENU"]) {
      expect(values).toContain(item);
    }
  });

  it("draws the game-over copy", () => {
    const game = playing();
    game.sim.score = 310;
    game.best = 400;
    game.goTo("gameover");
    const values = draw(game).texts.map((entry) => entry.value);
    expect(values).toContain("GAME OVER");
    expect(values).toContain("SCORE");
    expect(values).toContain("310");
    expect(values).toContain("PLAY AGAIN");
  });

  it("draws the cleared heading in place of the game-over one", () => {
    const game = playing();
    game.goTo("cleared");
    const values = draw(game).texts.map((entry) => entry.value);
    expect(values).toContain("BOARD CLEARED");
    expect(values).not.toContain("GAME OVER");
  });
});
