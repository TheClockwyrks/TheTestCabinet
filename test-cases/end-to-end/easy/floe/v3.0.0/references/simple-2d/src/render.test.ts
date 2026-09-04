// Floe — what the render puts on the stage, read off real pixels and real art.
//
// These checks draw onto an `@napi-rs/canvas` canvas at the logical stage size, so
// a logical coordinate is a device pixel and a sample is taken where the
// specification puts the thing being sampled. The seeded PNGs are read off the
// project's own `assets/` tree and handed to the render as the sprite set, so what
// is asserted here is the art the case seeds rather than the shapes the build falls
// back to.
//
// WHAT IS ASSERTED IS `specs/overview.md`'s LEGIBILITY TABLE, as distances rather
// than as colours: the five bands told apart, deep water told from a floe, an open
// bay told from the shore beside it, the critter and the bear told from whatever
// they stand on, and the submerged bear told from the water it is under. The
// palette itself is this build's and nothing here names one.

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ICE_TOP,
  ROW_BAYS,
  ROW_MEDIAN,
  ROW_NEAR,
  SPRITE_TILE,
  STAGE_H,
  STAGE_W,
  TILE,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "./constants";
import { emptySprites, type Frames, type Sprites } from "./assets";
import { blankState } from "./flow";
import { renderGame } from "./render";
import { toSim, type Sim } from "./sim";
import type { FloeState } from "./game";

/** Every folder of the seeded art, and how many frames each holds. */
const FOLDERS: Readonly<Record<keyof Sprites, number>> = {
  crosser: 8,
  bear: 18,
  plow: 1,
  dogsled: 1,
  car: 1,
  pan: 1,
  raft: 2,
};

let seeded: Sprites;

beforeAll(async () => {
  const loaded: Partial<Record<keyof Sprites, Frames>> = {};
  for (const name of Object.keys(FOLDERS) as (keyof Sprites)[]) {
    const frames: (ImageBitmap | null)[] = [];
    for (let index = 0; index < FOLDERS[name]; index += 1) {
      const bytes = readFileSync(join("assets", name, `${index}.png`));
      frames.push((await loadImage(bytes)) as unknown as ImageBitmap);
    }
    loaded[name] = frames;
  }
  seeded = loaded as Sprites;
});

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Shot {
  pixel(x: number, y: number): Rgb;
  box(x: number, y: number, width: number, height: number): Rgb[];
}

/** Draw the state and hand back a reader over the pixels it produced. */
function draw(state: FloeState): Shot {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  renderGame(state, ctx as unknown as CanvasRenderingContext2D);
  const read = (x: number, y: number, w: number, h: number): Rgb[] => {
    const { data } = (ctx as SKRSContext2D).getImageData(x, y, w, h);
    const pixels: Rgb[] = [];
    for (let index = 0; index < data.length; index += 4) {
      pixels.push({ r: data[index], g: data[index + 1], b: data[index + 2] });
    }
    return pixels;
  };
  return {
    pixel: (x, y) => read(Math.round(x), Math.round(y), 1, 1)[0],
    box: (x, y, w, h) => read(Math.round(x), Math.round(y), w, h),
  };
}

/** The RGB distance between two colours, out of 441. */
function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** The mean of a run of pixels. */
function mean(pixels: readonly Rgb[]): Rgb {
  const total = pixels.reduce(
    (sum, pixel) => ({
      r: sum.r + pixel.r,
      g: sum.g + pixel.g,
      b: sum.b + pixel.b,
    }),
    { r: 0, g: 0, b: 0 },
  );
  return {
    r: total.r / pixels.length,
    g: total.g / pixels.length,
    b: total.b / pixels.length,
  };
}

/** How bright a colour is, on the 0–255 scale (Rec. 601). */
function luminance(color: Rgb): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

/** The mean of the brightest twentieth of a box: what a mark on a band reads as. */
function litColor(pixels: readonly Rgb[]): Rgb {
  const sorted = [...pixels].sort((a, b) => luminance(b) - luminance(a));
  return mean(sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.05))));
}

/** The mean of the twentieth of a box furthest from `ground`. */
function markColor(pixels: readonly Rgb[], ground: Rgb): Rgb {
  const sorted = [...pixels].sort(
    (a, b) => distance(b, ground) - distance(a, ground),
  );
  return mean(sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.05))));
}

/** A live crossing on an emptied strait, drawn with the seeded art. */
function scene(change: (sim: Sim) => void, sprites = seeded): FloeState {
  const sim = toSim({ ...blankState(), sprites });
  sim.screen = "playing";
  sim.vehicles = [];
  sim.floes = [];
  sim.bears = [];
  sim.critter = { ...sim.critter, present: false };
  change(sim);
  return sim;
}

/** The band tint at a row, read across the width away from the bays. */
function bandTint(shot: Shot, row: number): Rgb {
  return mean(shot.box(200, tileTop(row) + 8, 600, TILE - 16));
}

/** The tile box a mark on `(col, row)` is read through, inset from its edges. */
function tileBox(shot: Shot, col: number, row: number): Rgb[] {
  return shot.box(tileLeft(col) + 4, tileTop(row) + 4, TILE - 8, TILE - 8);
}

describe("the five bands", () => {
  it("renders each in a tint separated from the others", () => {
    const shot = draw(scene(() => undefined));
    const tints = [ROW_BAYS - 1, 5, ROW_MEDIAN, ICE_TOP + 3, ROW_NEAR].map(
      (row) => bandTint(shot, row),
    );
    for (let a = 0; a < tints.length; a += 1) {
      for (let b = a + 1; b < tints.length; b += 1) {
        expect(distance(tints[a], tints[b])).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("renders an open bay apart from the shore, and a filled bay apart from an open one", () => {
    const open = draw(scene(() => undefined));
    const shore = open.pixel(tileCX(7), tileCY(ROW_BAYS));
    const bayOpen = open.pixel(tileCX(3) + 8, tileCY(ROW_BAYS));
    expect(distance(shore, bayOpen)).toBeGreaterThanOrEqual(60);

    const filled = draw(
      scene((sim) => {
        sim.bays = [true, false, false, false, false];
      }),
    );
    const bayFilled = filled.pixel(tileCX(3) + 8, tileCY(ROW_BAYS));
    expect(distance(bayOpen, bayFilled)).toBeGreaterThanOrEqual(60);
  });

  it("renders deep water apart from a floe on the same row", () => {
    const shot = draw(
      scene((sim) => {
        sim.floes = [{ id: 1, row: 5, kind: "raft4", x: tileLeft(10), len: 4 }];
      }),
    );
    const water = mean(tileBox(shot, 20, 5));
    const floe = mean(tileBox(shot, 11, 5));
    expect(distance(water, floe)).toBeGreaterThanOrEqual(60);
  });
});

describe("the bodies", () => {
  it("draws the critter apart from every band it can stand on", () => {
    for (const [col, row] of [
      [20, ROW_NEAR],
      [20, ICE_TOP + 3],
      [20, ROW_MEDIAN],
    ] as const) {
      const bare = draw(scene(() => undefined));
      const ground = mean(tileBox(bare, col, row));
      const shot = draw(
        scene((sim) => {
          sim.critter = {
            present: true,
            x: tileCX(col),
            y: tileCY(row),
            facing: "up",
            hopCooldown: 0,
            bestRow: row,
          };
        }),
      );
      const pixels = tileBox(shot, col, row);
      expect(
        distance(markColor(pixels, ground), ground),
      ).toBeGreaterThanOrEqual(60);
      expect(distance(litColor(pixels), ground)).toBeGreaterThanOrEqual(60);
    }
  });

  it("draws the critter apart from a floe under it", () => {
    const floe = (sim: Sim): void => {
      sim.floes = [{ id: 1, row: 5, kind: "raft4", x: tileLeft(18), len: 4 }];
    };
    const bare = draw(scene(floe));
    const ground = mean(tileBox(bare, 20, 5));
    const shot = draw(
      scene((sim) => {
        floe(sim);
        sim.critter = {
          present: true,
          x: tileCX(20),
          y: tileCY(5),
          facing: "up",
          hopCooldown: 0,
          bestRow: 5,
        };
      }),
    );
    const pixels = tileBox(shot, 20, 5);
    expect(distance(markColor(pixels, ground), ground)).toBeGreaterThanOrEqual(
      60,
    );
  });

  it("draws a bear apart from every band it can travel on", () => {
    for (const [col, row] of [
      [20, ROW_NEAR],
      [20, ICE_TOP + 3],
      [20, ROW_MEDIAN],
    ] as const) {
      const bare = draw(scene(() => undefined));
      const ground = mean(tileBox(bare, col, row));
      const shot = draw(
        scene((sim) => {
          sim.bears = [
            {
              id: 1,
              col,
              row,
              stepCol: col,
              stepRow: row,
              x: tileCX(col),
              y: tileCY(row),
              facing: "up",
              target: { col, row },
              sense: true,
              routing: true,
              travel: true,
              carry: 0,
            },
          ];
        }),
      );
      const pixels = tileBox(shot, col, row);
      expect(
        distance(markColor(pixels, ground), ground),
      ).toBeGreaterThanOrEqual(60);
      expect(distance(litColor(pixels), ground)).toBeGreaterThanOrEqual(60);
    }
  });

  it("keeps a submerged bear visible against the water", () => {
    const bare = draw(scene(() => undefined));
    const water = mean(tileBox(bare, 20, 5));
    const shot = draw(
      scene((sim) => {
        sim.bears = [
          {
            id: 1,
            col: 20,
            row: 5,
            stepCol: 20,
            stepRow: 5,
            x: tileCX(20),
            y: tileCY(5),
            facing: "up",
            target: { col: 20, row: 5 },
            sense: true,
            routing: true,
            travel: true,
            carry: 0,
          },
        ];
      }),
    );
    const pixels = tileBox(shot, 20, 5);
    expect(distance(markColor(pixels, water), water)).toBeGreaterThanOrEqual(
      60,
    );
  });
});

describe("the seeded art", () => {
  /** The columns of a lane item's drawn box, as mean colours. */
  function columns(shot: Shot, x: number, row: number, width: number): Rgb[] {
    const out: Rgb[] = [];
    for (let offset = 0; offset < width; offset += 1) {
      out.push(mean(shot.box(x + offset, tileTop(row) + 4, 1, TILE - 8)));
    }
    return out;
  }

  it("mirrors a vehicle in a leftward lane against one in a rightward lane", () => {
    const rightward = draw(
      scene((sim) => {
        sim.iceLanes = sim.iceLanes.map((lane) =>
          lane.row === ICE_TOP ? { ...lane, dir: 1, speed: 0 } : lane,
        );
        sim.vehicles = [
          { id: 1, row: ICE_TOP, kind: "car", x: tileLeft(10), len: 2 },
        ];
      }),
    );
    const leftward = draw(
      scene((sim) => {
        sim.iceLanes = sim.iceLanes.map((lane) =>
          lane.row === ICE_TOP ? { ...lane, dir: -1, speed: 0 } : lane,
        );
        sim.vehicles = [
          { id: 1, row: ICE_TOP, kind: "car", x: tileLeft(10), len: 2 },
        ];
      }),
    );
    const a = columns(rightward, tileLeft(10), ICE_TOP, 64);
    const b = columns(leftward, tileLeft(10), ICE_TOP, 64);
    // The same art, drawn the other way round: column `i` of one matches column
    // `width - 1 - i` of the other, and the two are plainly not identical.
    const mirrored = a.map((_, index) => distance(a[index], b[63 - index]));
    const same = a.map((_, index) => distance(a[index], b[index]));
    expect(Math.max(...mirrored)).toBeLessThan(24);
    expect(Math.max(...same)).toBeGreaterThan(24);
  });

  it("draws a plow 96 units wide over the three tiles it spans", () => {
    const shot = draw(
      scene((sim) => {
        sim.iceLanes = sim.iceLanes.map((lane) =>
          lane.row === ICE_TOP ? { ...lane, dir: 1, speed: 0 } : lane,
        );
        sim.vehicles = [
          { id: 1, row: ICE_TOP, kind: "plow", x: tileLeft(10), len: 3 },
        ];
      }),
    );
    const bare = draw(scene(() => undefined));
    const ice = mean(tileBox(bare, 20, ICE_TOP));
    for (const col of [10, 11, 12]) {
      const pixels = tileBox(shot, col, ICE_TOP);
      expect(distance(markColor(pixels, ice), ice)).toBeGreaterThan(30);
    }
    // And nothing beyond the three tiles it spans.
    const beyond = mean(tileBox(shot, 13, ICE_TOP));
    expect(distance(beyond, ice)).toBeLessThan(12);
  });

  it("draws the three-tile raft from the left 96 x 32 of its frame", () => {
    const three = draw(
      scene((sim) => {
        sim.floes = [{ id: 1, row: 4, kind: "raft3", x: tileLeft(10), len: 3 }];
      }),
    );
    const four = draw(
      scene((sim) => {
        sim.floes = [{ id: 1, row: 4, kind: "raft4", x: tileLeft(10), len: 4 }];
      }),
    );
    const bare = draw(scene(() => undefined));
    const water = mean(tileBox(bare, 20, 4));

    // Both rafts read as ice across every tile they span, and neither spills over.
    for (const col of [10, 11, 12]) {
      expect(distance(mean(tileBox(three, col, 4)), water)).toBeGreaterThan(60);
    }
    expect(distance(mean(tileBox(three, 13, 4)), water)).toBeLessThan(12);
    for (const col of [10, 11, 12, 13]) {
      expect(distance(mean(tileBox(four, col, 4)), water)).toBeGreaterThan(60);
    }
    expect(distance(mean(tileBox(four, 14, 4)), water)).toBeLessThan(12);

    // The three-tile raft is the LEFT 96 of the same 128-wide art the four-tile
    // raft fills, so its first 96 units are not the four-tile raft's first 96.
    const a = columns(three, tileLeft(10), 4, 96);
    const b = columns(four, tileLeft(10), 4, 96);
    expect(Math.max(...a.map((_, i) => distance(a[i], b[i])))).toBeGreaterThan(
      8,
    );
  });

  it("draws the critter from the pair for its facing", () => {
    // Each facing's pair is a different drawing, so the four look different from
    // one another on the same tile.
    const shots = (["up", "down", "left", "right"] as const).map((facing) =>
      columns(
        draw(
          scene((sim) => {
            sim.animTime = 0;
            sim.critter = {
              present: true,
              x: tileCX(20),
              y: tileCY(ROW_MEDIAN),
              facing,
              hopCooldown: 0,
              bestRow: ROW_MEDIAN,
            };
          }),
        ),
        tileCX(20) - SPRITE_TILE / 2,
        ROW_MEDIAN,
        SPRITE_TILE,
      ),
    );
    for (let a = 0; a < shots.length; a += 1) {
      for (let b = a + 1; b < shots.length; b += 1) {
        const worst = Math.max(
          ...shots[a].map((_, index) =>
            distance(shots[a][index], shots[b][index]),
          ),
        );
        expect(worst).toBeGreaterThan(4);
      }
    }
  });

  it("draws a bear from its swim set over open water and its run set over ice", () => {
    const bear = (row: number) =>
      columns(
        draw(
          scene((sim) => {
            sim.animTime = 0;
            sim.bears = [
              {
                id: 1,
                col: 20,
                row,
                stepCol: 20,
                stepRow: row,
                x: tileCX(20),
                y: tileCY(row),
                facing: "up",
                target: { col: 20, row },
                sense: true,
                routing: true,
                travel: true,
                carry: 0,
              },
            ];
          }),
        ),
        tileCX(20) - SPRITE_TILE / 2,
        row,
        SPRITE_TILE,
      );
    const swim = bear(5);
    const run = bear(ROW_MEDIAN);
    expect(
      Math.max(...swim.map((_, index) => distance(swim[index], run[index]))),
    ).toBeGreaterThan(20);
  });
});

describe("the HUD and the screens", () => {
  it("draws nothing of the strait inside the HUD bar", () => {
    const shot = draw(
      scene((sim) => {
        sim.critter = {
          present: true,
          x: tileCX(20),
          y: tileCY(0),
          facing: "up",
          hopCooldown: 0,
          bestRow: 0,
        };
      }),
    );
    // The bar's own ground, sampled where no readout is drawn.
    const bar = shot.pixel(1250, 40);
    const panel = shot.pixel(1250, 8);
    expect(distance(bar, panel)).toBeLessThan(8);
  });

  it("changes only the mark of the bay that was filled", () => {
    const open = draw(scene(() => undefined));
    const filled = draw(
      scene((sim) => {
        sim.bays = [false, false, true, false, false];
      }),
    );
    const markOf = (shot: Shot, index: number): Rgb =>
      mean(shot.box(128 + index * 256 - 12, 61, 24, 10));
    expect(distance(markOf(open, 2), markOf(filled, 2))).toBeGreaterThan(60);
    for (const index of [0, 1, 3, 4]) {
      expect(distance(markOf(open, index), markOf(filled, index))).toBeLessThan(
        4,
      );
    }
  });

  it("draws every screen, with or without the art", () => {
    for (const sprites of [seeded, emptySprites()]) {
      for (const screen of [
        "title",
        "howto",
        "playing",
        "paused",
        "victory",
        "gameover",
      ] as const) {
        const shot = draw(
          scene((sim) => {
            sim.screen = screen;
            sim.bays = [true, false, false, false, false];
            sim.fishBay = 3;
            sim.critter = { ...sim.critter, present: true };
            sim.bears = [
              {
                id: 1,
                col: 21,
                row: ROW_MEDIAN,
                stepCol: 21,
                stepRow: ROW_MEDIAN,
                x: tileCX(21),
                y: tileCY(ROW_MEDIAN),
                facing: "left",
                target: { col: 21, row: ROW_MEDIAN },
                sense: true,
                routing: true,
                travel: true,
                carry: 0,
              },
            ];
            sim.vehicles = [
              { id: 2, row: ICE_TOP, kind: "plow", x: tileLeft(4), len: 3 },
            ];
            sim.floes = [
              { id: 3, row: 6, kind: "raft3", x: tileLeft(8), len: 3 },
              { id: 4, row: 7, kind: "pan", x: tileLeft(12), len: 1 },
            ];
          }, sprites),
        );
        // Something is on the stage in every corner region: the fit reaches all
        // four edges of the logical stage.
        for (const [x, y] of [
          [2, 2],
          [STAGE_W - 3, 2],
          [2, STAGE_H - 3],
          [STAGE_W - 3, STAGE_H - 3],
        ] as const) {
          const pixel = shot.pixel(x, y);
          expect(pixel.r + pixel.g + pixel.b).toBeGreaterThan(0);
        }
      }
    }
  });
});
