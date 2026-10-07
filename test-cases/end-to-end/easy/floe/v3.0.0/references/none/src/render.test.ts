/// <reference types="node" />
// This suite runs in Node and reads the disk. The project's tsconfig sets
// `types: []` to keep the game's own sources browser-only, so the suites that
// need Node's types name them here instead.

// What the game draws, over a real 2D context.
//
// The frames are read straight off the project's own `assets/` directory: a Node
// process has no page to resolve a page-relative URL against, and what is being
// checked here is the drawing rather than the loading. Every reading is a pixel
// off the finished stage, so a change of position, of size, of mirroring or of
// which frame was chosen is caught as a difference in the picture.

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import {
  HUD_H,
  ICE_TOP,
  ROW_BAYS,
  ROW_MEDIAN,
  ROW_NEAR,
  STAGE_H,
  STAGE_W,
  TILE,
  WATER_TOP,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "./constants";
import {
  BEAR_LUNGE_BASE,
  BEAR_SWIM_BASE,
  facingPair,
  type Art,
} from "./assets";
import { render } from "./render";
import {
  harness,
  lastId,
  startCrossing,
  type Harness,
} from "./harness.test-support";
import type { FloeState } from "./types";

/** Every folder of the seeded art, decoded off disk. */
async function loadArtFromDisk(): Promise<Art> {
  const folders = {
    crosser: 8,
    bear: 18,
    plow: 1,
    dogsled: 1,
    car: 1,
    pan: 1,
    raft: 2,
  } as const;
  const art: Record<string, unknown[]> = {};
  for (const [folder, count] of Object.entries(folders)) {
    art[folder] = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        loadImage(`assets/${folder}/${index}.png`),
      ),
    );
  }
  return art as unknown as Art;
}

let art: Art;

beforeAll(async () => {
  art = await loadArtFromDisk();
});

/** Draw one state onto a stage-sized canvas and hand back a pixel reader. */
function draw(state: FloeState): {
  pixel(x: number, y: number): [number, number, number, number];
  ctx: SKRSContext2D;
} {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  render(state, art, ctx as unknown as CanvasRenderingContext2D, 0);
  return {
    ctx,
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
  };
}

/** The RGB distance between two pixels, out of 441. */
function apart(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** The pixels of one tile, as a flat list. */
function tilePixels(
  read: (x: number, y: number) => [number, number, number, number],
  col: number,
  row: number,
): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let y = 2; y < TILE - 2; y += 2) {
    for (let x = 2; x < TILE - 2; x += 2) {
      out.push(read(tileLeft(col) + x, tileTop(row) + y));
    }
  }
  return out;
}

/**
 * Which of the eighteen bear frames was drawn centred on `(cx, cy)`, or `-1`
 * where none of them was.
 *
 * The frames are drawn one source pixel to one stage unit with smoothing off, so
 * every opaque pixel of the frame reaches the stage unchanged. Matching the
 * finished picture against each frame in turn therefore says exactly which frame
 * the game chose, which is what `specs/assets.md` fixes.
 */
function bearFrameDrawnAt(ctx: SKRSContext2D, cx: number, cy: number): number {
  const drawn = ctx.getImageData(
    Math.round(cx - TILE / 2),
    Math.round(cy - TILE / 2),
    TILE,
    TILE,
  ).data;
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < art.bear.length; index += 1) {
    const frame = createCanvas(TILE, TILE);
    const frameCtx = frame.getContext("2d");
    frameCtx.drawImage(art.bear[index] as never, 0, 0, TILE, TILE);
    const source = frameCtx.getImageData(0, 0, TILE, TILE).data;
    let opaque = 0;
    let matched = 0;
    for (let i = 0; i < source.length; i += 4) {
      if (source[i + 3] < 250) continue;
      opaque += 1;
      if (
        Math.abs(source[i] - drawn[i]) <= 2 &&
        Math.abs(source[i + 1] - drawn[i + 1]) <= 2 &&
        Math.abs(source[i + 2] - drawn[i + 2]) <= 2
      ) {
        matched += 1;
      }
    }
    const score = opaque === 0 ? 0 : matched / opaque;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return bestScore >= 0.98 ? best : -1;
}

/** An emptied, live strait to draw over. */
function scene(): Harness {
  const h = harness();
  startCrossing(h);
  h.api.removeCritter();
  return h;
}

describe("the strait's bands", () => {
  it("draws each of the five in a tint the others are told apart from", () => {
    const h = scene();
    const { pixel } = draw(h.state);
    const bands = {
      nearShore: pixel(tileCX(20), tileCY(ROW_NEAR)),
      ice: pixel(tileCX(20), tileCY(ICE_TOP + 3)),
      median: pixel(tileCX(20), tileCY(ROW_MEDIAN)),
      water: pixel(tileCX(20), tileTop(WATER_TOP + 3) + 8),
      farShore: pixel(tileCX(15), tileCY(ROW_BAYS)),
    };
    const names = Object.keys(bands) as (keyof typeof bands)[];
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        expect(
          apart(bands[names[i]], bands[names[j]]),
          `${names[i]} vs ${names[j]}`,
        ).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("draws an open bay apart from the shore, and a filled one apart from an open one", () => {
    const h = scene();
    const open = draw(h.state).pixel(tileCX(3), tileCY(ROW_BAYS));
    const shore = draw(h.state).pixel(tileCX(15), tileCY(ROW_BAYS));
    expect(apart(open, shore)).toBeGreaterThanOrEqual(60);

    h.api.setBay(0, true);
    const filled = draw(h.state).pixel(tileCX(3), tileCY(ROW_BAYS));
    expect(apart(filled, open)).toBeGreaterThanOrEqual(60);
  });

  it("draws nothing of the strait inside the HUD bar", () => {
    const h = scene();
    h.api.addCritter(20, ROW_BAYS);
    h.api.addBear(21, ROW_BAYS);
    h.api.addVehicle(ROW_BAYS, "plow", tileLeft(2));
    const bare = draw(harness().state);
    const busy = draw(h.state);
    for (let x = 0; x < STAGE_W; x += 16) {
      for (let y = 0; y < HUD_H; y += 8) {
        expect(busy.pixel(x, y), `${x},${y}`).toEqual(bare.pixel(x, y));
      }
    }
  });
});

describe("the seeded art", () => {
  it("draws the critter from its own frames, centred on its centre", () => {
    const h = scene();
    h.api.addCritter(20, ROW_MEDIAN);
    const { pixel } = draw(h.state);
    const bare = draw(scene().state);
    const drawn = tilePixels(pixel, 20, ROW_MEDIAN);
    const empty = tilePixels(bare.pixel, 20, ROW_MEDIAN);
    const changed = drawn.filter(
      (value, index) => apart(value, empty[index]) > 8,
    );
    expect(changed.length).toBeGreaterThan(10);
    // Nothing spills into the neighbouring tiles.
    for (const col of [19, 21]) {
      const beside = tilePixels(pixel, col, ROW_MEDIAN);
      const bareBeside = tilePixels(bare.pixel, col, ROW_MEDIAN);
      expect(
        beside.every((value, index) => apart(value, bareBeside[index]) <= 8),
      ).toBe(true);
    }
  });

  it("draws a different critter frame for each facing", () => {
    const h = scene();
    h.api.addCritter(20, ROW_MEDIAN);
    const seen = new Map<string, string>();
    for (const facing of ["up", "down", "left", "right"] as const) {
      h.api.setCritterFacing(facing);
      const { ctx } = draw(h.state);
      const patch = ctx.getImageData(
        tileLeft(20),
        tileTop(ROW_MEDIAN),
        TILE,
        TILE,
      );
      seen.set(facing, Buffer.from(patch.data).toString("base64"));
    }
    expect(new Set(seen.values()).size).toBe(4);
    expect(facingPair("down")).toBe(0);
    expect(facingPair("up")).toBe(2);
    expect(facingPair("left")).toBe(4);
    expect(facingPair("right")).toBe(6);
  });

  it("draws each vehicle over every tile it spans", () => {
    for (const [kind, len] of [
      ["plow", 3],
      ["dogsled", 2],
      ["car", 2],
    ] as const) {
      const h = scene();
      h.api.setLaneDirection(ICE_TOP, 1);
      h.api.addVehicle(ICE_TOP, kind, tileLeft(10));
      const { pixel } = draw(h.state);
      const bare = draw(scene().state);
      for (let offset = 0; offset < len; offset += 1) {
        const drawn = tilePixels(pixel, 10 + offset, ICE_TOP);
        const empty = tilePixels(bare.pixel, 10 + offset, ICE_TOP);
        const changed = drawn.filter(
          (value, index) => apart(value, empty[index]) > 8,
        );
        expect(changed.length, `${kind} tile ${offset}`).toBeGreaterThan(8);
      }
      const past = tilePixels(pixel, 10 + len, ICE_TOP);
      const bareePast = tilePixels(bare.pixel, 10 + len, ICE_TOP);
      expect(
        past.every((value, index) => apart(value, bareePast[index]) <= 8),
        `${kind} spills past its span`,
      ).toBe(true);
    }
  });

  it("mirrors a vehicle in a leftward lane and leaves a rightward one alone", () => {
    const patch = (dir: 1 | -1): Buffer => {
      const h = scene();
      h.api.setLaneDirection(ICE_TOP, dir);
      h.api.addVehicle(ICE_TOP, "plow", tileLeft(10));
      const { ctx } = draw(h.state);
      return Buffer.from(
        ctx.getImageData(tileLeft(10), tileTop(ICE_TOP), TILE * 3, TILE).data,
      );
    };
    const rightward = patch(1);
    const leftward = patch(-1);
    expect(rightward.equals(leftward)).toBe(false);

    // The one is the other, flipped about its own middle.
    const width = TILE * 3;
    let matched = 0;
    let counted = 0;
    for (let y = 0; y < TILE; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const a = (y * width + x) * 4;
        const b = (y * width + (width - 1 - x)) * 4;
        counted += 1;
        if (
          Math.abs(rightward[a] - leftward[b]) <= 2 &&
          Math.abs(rightward[a + 1] - leftward[b + 1]) <= 2 &&
          Math.abs(rightward[a + 2] - leftward[b + 2]) <= 2
        ) {
          matched += 1;
        }
      }
    }
    expect(matched / counted).toBeGreaterThan(0.95);
  });

  it("draws the three-tile raft from the left of its frame and the four-tile one whole", () => {
    for (const [kind, len] of [
      ["pan", 1],
      ["raft3", 3],
      ["raft4", 4],
    ] as const) {
      const h = scene();
      h.api.addFloe(WATER_TOP, kind, tileLeft(10));
      const { pixel } = draw(h.state);
      const bare = draw(scene().state);
      for (let offset = 0; offset < len; offset += 1) {
        const drawn = tilePixels(pixel, 10 + offset, WATER_TOP);
        const empty = tilePixels(bare.pixel, 10 + offset, WATER_TOP);
        const changed = drawn.filter(
          (value, index) => apart(value, empty[index]) > 8,
        );
        expect(changed.length, `${kind} tile ${offset}`).toBeGreaterThan(8);
      }
      const past = tilePixels(pixel, 10 + len, WATER_TOP);
      const barePast = tilePixels(bare.pixel, 10 + len, WATER_TOP);
      expect(
        past.every((value, index) => apart(value, barePast[index]) <= 8),
        `${kind} spills past its span`,
      ).toBe(true);
    }
  });

  it("draws a bear from its run set on ice, its swim set over water, and its lunge on a catch", () => {
    expect(BEAR_SWIM_BASE).toBe(8);
    expect(BEAR_LUNGE_BASE).toBe(16);

    const frameAt = (h: Harness, x: number, y: number): number =>
      bearFrameDrawnAt(draw(h.state).ctx, x, y);

    const onIce = (() => {
      const h = scene();
      h.api.addBear(20, ROW_MEDIAN);
      h.api.setBearRouting(lastId(h.api.snapshot().bears), false);
      return frameAt(h, tileCX(20), tileCY(ROW_MEDIAN));
    })();
    expect(onIce).toBeGreaterThanOrEqual(0);
    expect(onIce).toBeLessThan(BEAR_SWIM_BASE);

    const swimming = (() => {
      const h = scene();
      h.api.addBear(20, WATER_TOP + 2);
      h.api.setBearRouting(lastId(h.api.snapshot().bears), false);
      return frameAt(h, tileCX(20), tileCY(WATER_TOP + 2));
    })();
    expect(swimming).toBeGreaterThanOrEqual(BEAR_SWIM_BASE);
    expect(swimming).toBeLessThan(BEAR_LUNGE_BASE);

    const onAFloe = (() => {
      const h = scene();
      h.api.addFloe(WATER_TOP + 2, "pan", tileLeft(20));
      h.api.addBear(20, WATER_TOP + 2);
      h.api.setBearRouting(lastId(h.api.snapshot().bears), false);
      return frameAt(h, tileCX(20), tileCY(WATER_TOP + 2));
    })();
    expect(onAFloe).toBe(onIce);

    // Every bear leaves the strait on the tick it catches (specs/hunter.md), so
    // the lunge is what is drawn where the two met rather than a bear on the
    // roster. It is still the bear's own lunge pair.
    const lunging = (() => {
      const h = scene();
      h.api.setCatchTest(true);
      h.api.addCritter(20, ROW_MEDIAN);
      h.api.addBear(20, ROW_MEDIAN);
      h.api.setBearRouting(lastId(h.api.snapshot().bears), false);
      h.advance(1);
      expect(h.api.snapshot().bears).toEqual([]);
      expect(h.api.snapshot().phase).toBe("dying");
      return frameAt(h, tileCX(20), tileCY(ROW_MEDIAN));
    })();
    expect(lunging).toBeGreaterThanOrEqual(BEAR_LUNGE_BASE);
  });

  it("draws each of the bear's four facings from its own pair", () => {
    // Posed in the middle of the ice band, where all four neighbouring tiles are
    // ice: a bear reads its footing off the tile it is travelling INTO, so a step
    // up from the median would put it in the water and draw it swimming.
    const drawnFor = (facing: "up" | "down" | "left" | "right"): number => {
      const h = scene();
      h.api.setCritterTile(20, ICE_TOP + 3);
      h.api.addBear(20, ICE_TOP + 3);
      const id = lastId(h.api.snapshot().bears);
      h.api.setBearRouting(id, false);
      h.api.setBearSense(id, false);
      h.api.setBearTravel(id, false);
      h.api.setBearStep(id, facing);
      h.api.removeCritter();
      return bearFrameDrawnAt(
        draw(h.state).ctx,
        tileCX(20),
        tileCY(ICE_TOP + 3),
      );
    };
    expect(drawnFor("down")).toBe(facingPair("down"));
    expect(drawnFor("up")).toBe(facingPair("up"));
    expect(drawnFor("left")).toBe(facingPair("left"));
    expect(drawnFor("right")).toBe(facingPair("right"));
  });

  it("draws something distinct from the water where a swimming bear is", () => {
    const h = scene();
    h.api.addBear(20, WATER_TOP + 2);
    h.api.setBearRouting(lastId(h.api.snapshot().bears), false);
    const { pixel } = draw(h.state);
    const water = draw(scene().state).pixel(tileCX(24), tileCY(WATER_TOP + 2));
    const far = tilePixels(pixel, 20, WATER_TOP + 2).filter(
      (value) => apart(value, water) >= 60,
    );
    expect(far.length).toBeGreaterThan(10);
  });
});

describe("the HUD", () => {
  it("draws all five readouts inside the bar", () => {
    const h = scene();
    h.api.setScore(1234);
    h.api.setLives(2);
    h.api.setLevel(4);
    h.api.setTimer(17);
    h.api.setBay(1, true);
    const { ctx } = draw(h.state);
    const bar = ctx.getImageData(0, 0, STAGE_W, HUD_H).data;
    // Ink is anything far from the bar's own ground.
    const ground = ctx.getImageData(2, HUD_H - 30, 1, 1).data;
    let ink = 0;
    for (let i = 0; i < bar.length; i += 4) {
      if (
        Math.abs(bar[i] - ground[0]) +
          Math.abs(bar[i + 1] - ground[1]) +
          Math.abs(bar[i + 2] - ground[2]) >=
        60
      ) {
        ink += 1;
      }
    }
    expect(ink).toBeGreaterThan(500);
  });

  it("moves each readout with the value it reports", () => {
    const shot = (pose: (h: Harness) => void): string => {
      const h = scene();
      pose(h);
      const { ctx } = draw(h.state);
      return Buffer.from(ctx.getImageData(0, 0, STAGE_W, HUD_H).data).toString(
        "base64",
      );
    };
    const base = shot(() => undefined);
    expect(shot((h) => h.api.setScore(999))).not.toBe(base);
    expect(shot((h) => h.api.setLives(1))).not.toBe(base);
    expect(shot((h) => h.api.setLevel(6))).not.toBe(base);
    expect(shot((h) => h.api.setTimer(11))).not.toBe(base);
    expect(shot((h) => h.api.setBay(2, true))).not.toBe(base);
  });

  it("marks each bay at its own position", () => {
    const markOf = (
      bay: number,
      filled: boolean,
    ): [number, number, number, number] => {
      const h = scene();
      h.api.setBay(bay, filled);
      return draw(h.state).pixel(tileLeft(bay === 0 ? 4 : 4), 57);
    };
    const openMark = markOf(0, false);
    const filledMark = markOf(0, true);
    expect(apart(openMark, filledMark)).toBeGreaterThanOrEqual(60);

    // Filling one bay leaves another bay's mark alone.
    const h = scene();
    h.api.setBay(0, true);
    const far = draw(h.state).pixel(tileLeft(12), 57);
    expect(apart(far, openMark)).toBeLessThan(20);
  });
});

describe("the screens", () => {
  it("draws each of the six differently, and the playing screen bare", () => {
    const shots = new Map<string, string>();
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "victory",
      "gameover",
    ] as const) {
      const h = scene();
      h.api.setScreen(screen);
      const { ctx } = draw(h.state);
      shots.set(
        screen,
        Buffer.from(ctx.getImageData(0, 0, STAGE_W, STAGE_H).data).toString(
          "base64",
        ),
      );
    }
    expect(new Set(shots.values()).size).toBe(6);
  });

  it("draws the highlighted menu item apart from the others", () => {
    const shotOf = (index: number): Buffer => {
      const h = scene();
      h.api.setScreen("paused");
      h.api.setMenuIndex(index);
      const { ctx } = draw(h.state);
      return Buffer.from(ctx.getImageData(340, 330, 600, 160).data);
    };
    expect(shotOf(0).equals(shotOf(1))).toBe(false);
  });

  it("keeps every screen's text clear of its ground", () => {
    for (const screen of [
      "title",
      "howto",
      "paused",
      "victory",
      "gameover",
    ] as const) {
      const h = scene();
      h.api.setScreen(screen);
      const { ctx } = draw(h.state);
      const card = ctx.getImageData(360, 180, 560, 380).data;
      const ground = ctx.getImageData(365, 185, 1, 1).data;
      let ink = 0;
      for (let i = 0; i < card.length; i += 4) {
        if (
          Math.abs(card[i] - ground[0]) +
            Math.abs(card[i + 1] - ground[1]) +
            Math.abs(card[i + 2] - ground[2]) >=
          60
        ) {
          ink += 1;
        }
      }
      expect(ink, screen).toBeGreaterThan(300);
    }
  });
});

describe("drawing between two ticks", () => {
  it("puts a moving item between where it was and where it is", () => {
    const h = scene();
    h.api.setLaneDirection(ICE_TOP, 1);
    h.api.setLaneSpeed(ICE_TOP, 8);
    h.api.addVehicle(ICE_TOP, "car", tileLeft(10));
    h.advance(1);

    const at = (alpha: number): number => {
      const canvas = createCanvas(STAGE_W, STAGE_H);
      const ctx = canvas.getContext("2d");
      render(h.state, art, ctx as unknown as CanvasRenderingContext2D, alpha);
      const row = ctx.getImageData(
        0,
        tileTop(ICE_TOP) + TILE / 2,
        STAGE_W,
        1,
      ).data;
      const ice = [row[0], row[1], row[2]];
      for (let x = 0; x < STAGE_W; x += 1) {
        const i = x * 4;
        if (
          Math.abs(row[i] - ice[0]) +
            Math.abs(row[i + 1] - ice[1]) +
            Math.abs(row[i + 2] - ice[2]) >
          30
        ) {
          return x;
        }
      }
      return -1;
    };
    const early = at(0);
    const late = at(0.99);
    expect(early).toBeGreaterThanOrEqual(0);
    expect(late).toBeGreaterThan(early);
  });

  it("reads nothing back into the game", () => {
    const h = scene();
    h.api.addCritter(20, ROW_MEDIAN);
    h.api.addBear(4, ROW_MEDIAN);
    const before = h.api.snapshot();
    draw(h.state);
    draw(h.state);
    expect(h.api.snapshot()).toEqual(before);
  });
});
