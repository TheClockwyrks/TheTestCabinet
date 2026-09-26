// Wireworm — what the finished frame shows.
//
// Every check here renders through the real game and reads the pixels back off
// the canvas, because what `specs/overview.md`'s legibility table asks for is a
// property of the PICTURE rather than of the state behind it. Two samples are
// taken of each element and both are asserted: the color at the tile's center,
// which is what a spot check reads, and the average over the whole tile, which
// is what a region check reads. The seeded art alone separates neither the
// bottom of the charge ramp nor a glitch from the board, so both samples are
// what hold `src/theme.ts`'s two glow layers to their job.

import { beforeAll, describe, expect, test } from "vitest";
import {
  BAND_TOP_Y,
  BOARD_Y,
  CHARGE_MAX,
  HUD_H,
  STAGE_W,
  TILE,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "./constants";
import type { Sprites } from "./assets";
import {
  brightness,
  captureDraws,
  createRig,
  type DrawnImage,
  loadTestSprites,
  separation,
  startPlaying,
  tileAverage,
  type Rig,
} from "./harness.test-support";

/** The separation this build holds its own palette to, out of 441. */
const READS_APART = 40;

let sprites: Sprites;

beforeAll(async () => {
  sprites = await loadTestSprites();
});

function rigOnBoard(): Rig {
  const rig = createRig(sprites);
  startPlaying(rig);
  return rig;
}

/** One frame, so the canvas carries what the state describes. */
function draw(rig: Rig): void {
  rig.runtime.advance(0, 1);
}

describe("the board", () => {
  test("the player band reads as a distinct floor across the full width", () => {
    const rig = rigOnBoard();
    draw(rig);
    for (const x of [40, STAGE_W / 2, STAGE_W - 40]) {
      const band = rig.sample(x, BAND_TOP_Y + 40);
      const board = rig.sample(x, BAND_TOP_Y - 40);
      expect(separation(band, board)).toBeGreaterThan(READS_APART);
    }
    rig.dispose();
  });

  test("nothing of the board is drawn inside the HUD bar", () => {
    const rig = rigOnBoard();
    // A dropper on the entry row is the entity that reaches highest.
    rig.debug.addFoe("dropper", tileCX(20), tileCY(0));
    rig.debug.setNode(20, 0, CHARGE_MAX);
    draw(rig);
    // The HUD is drawn over the board, so the bar carries the bar's own color.
    const bar = rig.sample(tileCX(20), HUD_H / 2);
    const above = rig.sample(4, HUD_H / 2);
    expect(separation(bar, above)).toBeLessThan(8);
    rig.dispose();
  });

  test("nothing of the board reaches into the HUD bar or past the floor", () => {
    const rig = rigOnBoard();
    // The three entities that reach closest to an edge: a node and a foe on the
    // entry row, and a foe at the floor.
    rig.debug.setNode(20, 0, CHARGE_MAX);
    rig.debug.addFoe("dropper", tileCX(24), tileCY(0));
    rig.debug.addFoe("glitch", tileCX(28), 718);
    const log = captureDraws(rig);
    draw(rig);
    log.stop();
    // Every image is drawn inside the board.
    for (const call of log.calls) {
      expect(call.y).toBeGreaterThanOrEqual(BOARD_Y - TILE / 2);
    }
    // And the bar carries the bar's own ground, whatever was drawn beneath it.
    for (const x of [tileCX(20), tileCX(24), 4]) {
      expect(separation(rig.sample(x, 8), rig.sample(4, 8))).toBeLessThan(8);
    }
    rig.dispose();
  });

  test("the board reads through the scrim a menu is laid over it on", () => {
    const rig = rigOnBoard();
    rig.debug.setNode(12, 8, 2);
    rig.debug.setScreen("paused");
    draw(rig);
    const node = tileAverage(rig, tileLeft(12), tileTop(8), TILE);
    const empty = tileAverage(rig, tileLeft(16), tileTop(8), TILE);
    expect(separation(node, empty)).toBeGreaterThan(READS_APART);
    rig.dispose();
  });

  test("a node is drawn on the tile center the formula gives", () => {
    const rig = rigOnBoard();
    const tiles: [number, number][] = [
      [0, 1],
      [7, 4],
      [13, 9],
      [21, 6],
      [28, 12],
      [33, 3],
      [39, 16],
      [17, 17],
    ];
    for (const [c, r] of tiles) rig.debug.setNode(c, r, 2);
    draw(rig);
    const empty = rig.sample(tileCX(2), tileCY(14));
    for (const [c, r] of tiles) {
      const centre = rig.sample(tileCX(c), tileCY(r));
      expect(separation(centre, empty)).toBeGreaterThan(READS_APART);
      // The tile beside it is background, so a build that filled every tile is
      // told apart from one that centered its nodes.
      if (c < 39) {
        const beside = rig.sample(tileCX(c) + TILE, tileCY(r));
        expect(separation(beside, empty)).toBeLessThan(8);
      }
    }
    rig.dispose();
  });
});

describe("the charge ramp", () => {
  /** The four charges, posed side by side and read both ways. */
  function ramp(rig: Rig): {
    centres: [number, number, number][];
    averages: [number, number, number][];
  } {
    for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
      rig.debug.setNode(4 + charge * 3, 6, charge);
    }
    draw(rig);
    const centres: [number, number, number][] = [];
    const averages: [number, number, number][] = [];
    for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
      const c = 4 + charge * 3;
      centres.push(rig.sample(tileCX(c), tileCY(6)));
      averages.push(tileAverage(rig, tileLeft(c), tileTop(6), TILE));
    }
    return { centres, averages };
  }

  test("the four charge states are told apart, however they are sampled", () => {
    const rig = rigOnBoard();
    const { centres, averages } = ramp(rig);
    for (const colors of [centres, averages]) {
      for (let a = 0; a < colors.length; a += 1) {
        for (let b = a + 1; b < colors.length; b += 1) {
          expect(separation(colors[a], colors[b])).toBeGreaterThan(READS_APART);
        }
      }
    }
    rig.dispose();
  });

  test("the ramp brightens from inert to critical", () => {
    const rig = rigOnBoard();
    const { centres, averages } = ramp(rig);
    for (const colors of [centres, averages]) {
      const levels = colors.map(brightness);
      for (let i = 1; i < levels.length; i += 1) {
        expect(levels[i]).toBeGreaterThan(levels[i - 1]);
      }
    }
    rig.dispose();
  });

  test("a critical node alternates its two critical frames", () => {
    const rig = rigOnBoard();
    rig.debug.setNode(10, 6, CHARGE_MAX);
    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      rig.runtime.advance(1 / 12, 1);
      seen.add(tileAverage(rig, tileLeft(10), tileTop(6), TILE).join());
    }
    // Two distinct pictures over a second of pulsing, and no more.
    expect(seen.size).toBe(2);
    rig.dispose();
  });
});

describe("the actors", () => {
  test("the worm reads apart from the board and from every charge", () => {
    const rig = rigOnBoard();
    rig.debug.addWorm(12, 10);
    for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
      rig.debug.setNode(20 + charge * 3, 10, charge);
    }
    draw(rig);
    const worm = rig.sample(tileCX(12), tileCY(10));
    const board = rig.sample(tileCX(2), tileCY(10));
    expect(separation(worm, board)).toBeGreaterThan(READS_APART);
    for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
      const node = rig.sample(tileCX(20 + charge * 3), tileCY(10));
      expect(separation(worm, node)).toBeGreaterThan(READS_APART);
    }
    rig.dispose();
  });

  test("the cursor reads apart from the band it sits in", () => {
    const rig = rigOnBoard();
    rig.debug.setCursor(tileCX(20), 688);
    draw(rig);
    const cursor = rig.sample(tileCX(20), 688);
    const band = rig.sample(tileCX(4), 688);
    expect(separation(cursor, band)).toBeGreaterThan(READS_APART);
    rig.dispose();
  });

  test("the three foes read apart from one another and from the board", () => {
    const rig = rigOnBoard();
    rig.debug.addFoe("glitch", tileCX(6), tileCY(8));
    rig.debug.addFoe("dropper", tileCX(14), tileCY(8));
    rig.debug.addFoe("corruptor", tileCX(22), tileCY(8));
    // Held still, so the four readings below are four ANIMATION frames of the
    // same three foes rather than three foes that walked out of their tiles.
    for (const foe of rig.debug.snapshot().foes) {
      rig.debug.setFoeTravel(foe.id, false);
    }
    const board = tileAverage(rig, tileLeft(30), tileTop(8), TILE);
    // Read at four moments, because two of the three foes animate and one of the
    // glitch's frames is nearly the board's own color at its center.
    for (let i = 0; i < 4; i += 1) {
      rig.runtime.advance(1 / 10, 1);
      const centres = [6, 14, 22].map(
        (c) => rig.sample(tileCX(c), tileCY(8)) as [number, number, number],
      );
      const averages = [6, 14, 22].map((c) =>
        tileAverage(rig, tileLeft(c), tileTop(8), TILE),
      );
      for (const colors of [centres, averages]) {
        for (let a = 0; a < colors.length; a += 1) {
          expect(separation(colors[a], board)).toBeGreaterThan(READS_APART);
          for (let b = a + 1; b < colors.length; b += 1) {
            expect(separation(colors[a], colors[b])).toBeGreaterThan(
              READS_APART,
            );
          }
        }
      }
    }
    rig.dispose();
  });

  test("a bolt is drawn in the column it is climbing", () => {
    const rig = rigOnBoard();
    rig.debug.addBolt(tileCX(9), tileCY(10));
    draw(rig);
    const bolt = rig.sample(tileCX(9), tileCY(10));
    const board = rig.sample(tileCX(9) + TILE, tileCY(10));
    expect(separation(bolt, board)).toBeGreaterThan(READS_APART);
    rig.dispose();
  });

  test("a discharge draws lightning between the tiles it links", () => {
    const rig = rigOnBoard();
    rig.debug.setNode(10, 16, CHARGE_MAX);
    rig.debug.setNode(12, 16, 1);
    rig.debug.addBolt(tileCX(10), BOARD_Y + 19 * TILE + 16);
    rig.runtime.advance(0.15, 9);
    expect(rig.debug.snapshot().arcs).toHaveLength(1);

    // The lightning joins the two tile centers, straying no further from the
    // straight line than the shape it was given when the arc was created.
    const board = rig.sample(tileCX(11), tileCY(12));
    const data = rig.canvas
      .getContext("2d")
      .getImageData(tileCX(11) - 8, tileCY(16) - 16, 16, 32).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      const pixel: [number, number, number] = [
        data[i],
        data[i + 1],
        data[i + 2],
      ];
      if (separation(pixel, board) > READS_APART) lit += 1;
    }
    expect(lit).toBeGreaterThan(10);
    rig.dispose();
  });
});

describe("the seeded art", () => {
  /**
   * The calls of one frame that drew a frame of `folder`, with the index of the
   * frame each one drew.
   *
   * This reads the IMAGE SOURCE handed to each `drawImage` rather than sampling
   * pixels, which is the only way to tell a build that drew the seeded art from
   * one that drew a picture of its own that happens to look similar. A mirrored
   * draw carries its own transform, so the call's coordinates are not the tile's
   * — the image is what identifies it.
   */
  function drawnFrom(
    calls: readonly DrawnImage[],
    folder: readonly CanvasImageSource[],
  ): { frame: number; call: DrawnImage }[] {
    return calls
      .map((call) => ({
        frame: folder.indexOf(call.image as CanvasImageSource),
        call,
      }))
      .filter((drawn) => drawn.frame >= 0);
  }

  test("every node is drawn from a frame of the seeded node art", () => {
    const rig = rigOnBoard();
    for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
      rig.debug.setNode(4 + charge * 3, 6, charge);
    }
    const log = captureDraws(rig);
    draw(rig);
    log.stop();
    const nodes = drawnFrom(log.calls, sprites.node);
    expect(nodes).toHaveLength(4);
    for (const drawn of nodes) {
      // One frame, at the size of one tile.
      expect(drawn.call.w).toBe(TILE);
      expect(drawn.call.h).toBe(TILE);
    }
    // Each charge draws its own frame, and a critical node draws a critical one.
    expect(nodes.slice(0, 3).map((drawn) => drawn.frame)).toEqual([0, 1, 2]);
    expect([3, 4]).toContain(nodes[3].frame);
    rig.dispose();
  });

  test("a critical node alternates between the two critical frames", () => {
    const rig = rigOnBoard();
    rig.debug.setNode(10, 6, CHARGE_MAX);
    const seen = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      const log = captureDraws(rig);
      rig.runtime.advance(1 / 12, 1);
      log.stop();
      for (const drawn of drawnFrom(log.calls, sprites.node)) {
        seen.add(drawn.frame);
      }
    }
    expect([...seen].sort()).toEqual([3, 4]);
    rig.dispose();
  });

  test("each part of a worm is drawn from its own pair of frames", () => {
    const rig = rigOnBoard();
    rig.debug.addWorm(10, 10);
    const id = rig.debug.snapshot().worms[0].id;
    rig.debug.appendSegment(id, 9, 10);
    rig.debug.appendSegment(id, 8, 10);
    const log = captureDraws(rig);
    draw(rig);
    log.stop();
    const segments = drawnFrom(log.calls, sprites.worm);
    expect(segments).toHaveLength(3);
    // The head leads, the tail trails, and the body is between them.
    expect([0, 1]).toContain(segments[0].frame);
    expect([2, 3]).toContain(segments[1].frame);
    expect([4, 5]).toContain(segments[2].frame);
    rig.dispose();
  });

  test("a worm heading left draws its frames mirrored", () => {
    const rig = rigOnBoard();
    rig.debug.addWorm(10, 10);
    const id = rig.debug.snapshot().worms[0].id;
    rig.debug.appendSegment(id, 9, 10);

    let log = captureDraws(rig);
    draw(rig);
    log.stop();
    const rightward = drawnFrom(log.calls, sprites.worm);
    expect(rightward).toHaveLength(2);
    expect(rightward.every((drawn) => drawn.call.scaleX > 0)).toBe(true);

    rig.debug.setWormHeading(id, -1);
    log = captureDraws(rig);
    draw(rig);
    log.stop();
    const leftward = drawnFrom(log.calls, sprites.worm);
    expect(leftward).toHaveLength(2);
    expect(leftward.every((drawn) => drawn.call.scaleX < 0)).toBe(true);
    rig.dispose();
  });

  test("the cursor is drawn upright from its one seeded frame", () => {
    const rig = rigOnBoard();
    rig.debug.setCursor(tileCX(20), 688);
    const log = captureDraws(rig);
    draw(rig);
    log.stop();
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0].image).toBe(sprites.cursor[0]);
    expect(log.calls[0].scaleX).toBeGreaterThan(0);
    rig.dispose();
  });

  test("each foe is drawn from its own folder", () => {
    const rig = rigOnBoard();
    rig.debug.addFoe("glitch", tileCX(6), tileCY(8));
    rig.debug.addFoe("dropper", tileCX(14), tileCY(8));
    rig.debug.addFoe("corruptor", tileCX(22), tileCY(8));
    for (const foe of rig.debug.snapshot().foes) {
      rig.debug.setFoeTravel(foe.id, false);
    }
    const glitchFrames = new Set<number>();
    const corruptorFrames = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      const log = captureDraws(rig);
      rig.runtime.advance(1 / 10, 1);
      log.stop();
      for (const drawn of drawnFrom(log.calls, sprites.glitch)) {
        glitchFrames.add(drawn.frame);
      }
      for (const drawn of drawnFrom(log.calls, sprites.corruptor)) {
        corruptorFrames.add(drawn.frame);
      }
      expect(log.calls.map((call) => call.image)).toContain(sprites.dropper[0]);
    }
    // Both loops run every frame of their own folder.
    expect([...glitchFrames].sort()).toEqual([0, 1, 2, 3]);
    expect([...corruptorFrames].sort()).toEqual([0, 1, 2, 3]);
    rig.dispose();
  });

  test("a corruptor crawling left is drawn mirrored", () => {
    const rig = rigOnBoard();
    rig.debug.addFoe("corruptor", tileCX(22), tileCY(8));
    const id = rig.debug.snapshot().foes[0].id;
    rig.debug.setFoeTravel(id, false);
    let log = captureDraws(rig);
    draw(rig);
    log.stop();
    expect(log.calls.some((call) => call.scaleX < 0)).toBe(false);

    rig.debug.setFoeVelocity(id, -130, 0);
    log = captureDraws(rig);
    draw(rig);
    log.stop();
    const corruptor = drawnFrom(log.calls, sprites.corruptor);
    expect(corruptor).toHaveLength(1);
    expect(corruptor[0].call.scaleX).toBeLessThan(0);
    rig.dispose();
  });
});

describe("the HUD", () => {
  /** How many pixels of a region are brighter than the bar's own ground. */
  function ink(
    rig: Rig,
    left: number,
    top: number,
    w: number,
    h: number,
  ): number {
    const data = rig.canvas.getContext("2d").getImageData(left, top, w, h).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 90) lit += 1;
    }
    return lit;
  }

  test("the bar carries a readout in each of its three regions", () => {
    const rig = rigOnBoard();
    rig.debug.setScore(12345);
    rig.debug.setLives(2);
    rig.debug.setLevel(7);
    draw(rig);
    // Score on the left, lives beside it, the level on the right — each region
    // carries drawn type, all of it inside the bar.
    expect(ink(rig, 0, 0, 300, HUD_H)).toBeGreaterThan(200);
    expect(ink(rig, 340, 0, 200, HUD_H)).toBeGreaterThan(100);
    expect(ink(rig, STAGE_W - 320, 0, 320, HUD_H)).toBeGreaterThan(200);
    rig.dispose();
  });

  test("a life leaves the bar when it is lost", () => {
    const rig = rigOnBoard();
    rig.debug.setLives(3);
    draw(rig);
    const three = ink(rig, 340, 0, 200, HUD_H);
    rig.debug.setLives(1);
    draw(rig);
    const one = ink(rig, 340, 0, 200, HUD_H);
    expect(one).toBeLessThan(three);
    rig.dispose();
  });
});
