// What the frame drew, from the seeded art down.
//
// The engine's asset loader reaches for `fetch` and `createImageBitmap`, neither
// of which resolves a relative path in this host, so the art cannot be read off
// disk here. What this file does instead is hand `loadArt` a loader of its own
// that returns a flat 32x32 frame per path, painted in a color that names the
// folder and the frame index it stands for. A pixel read then says WHICH FRAME
// was drawn WHERE, which is what `specs/assets.md` fixes, without a file system
// and without asserting anything about the seeded art's own colors.

import { createCanvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InitApi } from "@test-cabinet/structured-2d";
import { ARC_LIFE, BOARD_Y, tileCX, tileCY } from "./constants";
import { arcPolyline, nodeFrame, segmentFrame } from "./render";
import { createHarness, poseWorm, startPlaying, type Harness } from "./harness";
import { loadArt } from "./sprites";

/** The color the stand-in frame `index` of `folder` is painted. */
function stand(folder: string, index: number): [number, number, number] {
  const base: Record<string, [number, number, number]> = {
    node: [200, 0, 0],
    worm: [0, 200, 0],
    cursor: [0, 0, 200],
    glitch: [200, 200, 0],
    dropper: [0, 200, 200],
    corruptor: [200, 0, 200],
  };
  const [r, g, b] = base[folder];
  return [r === 0 ? index * 7 + 1 : r - index * 20, g, b];
}

function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** A flat 32x32 frame, standing in for a decoded PNG. */
function flat(color: string): ImageBitmap {
  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 32, 32);
  return canvas as unknown as ImageBitmap;
}

/** A frame that is not its own mirror: left half one color, right half another. */
function sided(): ImageBitmap {
  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgb(10, 20, 30)";
  ctx.fillRect(0, 0, 16, 32);
  ctx.fillStyle = "rgb(240, 230, 220)";
  ctx.fillRect(16, 0, 16, 32);
  return canvas as unknown as ImageBitmap;
}

/** Every path the build asked for, and the frames it was handed. */
const asked: string[] = [];

function stubAssets(mirrorWorm = false): InitApi["assets"] {
  return {
    loadImage: async (path: string) => {
      asked.push(path);
      const [folder, file] = path.split("/");
      const index = Number.parseInt(file, 10);
      if (mirrorWorm && folder === "worm") return sided();
      return flat(rgb(stand(folder, index)));
    },
  } as unknown as InitApi["assets"];
}

let h: Harness;

beforeEach(async () => {
  asked.length = 0;
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("the art the build asks for", () => {
  it("names every frame of every folder, under the fixed asset root", async () => {
    await loadArt(stubAssets());
    expect(asked).toContain("node/0.png");
    expect(asked).toContain("node/4.png");
    expect(asked).toContain("worm/5.png");
    expect(asked).toContain("cursor/0.png");
    expect(asked).toContain("glitch/3.png");
    expect(asked).toContain("dropper/0.png");
    expect(asked).toContain("corruptor/3.png");
    expect(asked).toHaveLength(5 + 6 + 1 + 4 + 1 + 4);
    expect(asked.every((path) => !path.startsWith("/"))).toBe(true);
  });
});

describe("what is drawn from which frame", () => {
  it("draws a node from the frame for its charge", async () => {
    await loadArt(stubAssets());
    startPlaying(h.debug);
    for (const charge of [0, 1, 2]) {
      h.debug.setNode(4 + charge, 4, charge);
    }
    await h.advance(1);
    for (const charge of [0, 1, 2]) {
      expect(h.pixel(tileCX(4 + charge), tileCY(4))).toEqual(
        stand("node", charge),
      );
    }
  });

  it("pulses a critical node between its two frames", async () => {
    await loadArt(stubAssets());
    startPlaying(h.debug);
    h.debug.setNode(6, 6, 3);
    h.state.simTime = 0;
    await h.advance(1);
    expect(h.pixel(tileCX(6), tileCY(6))).toEqual(stand("node", 3));
    h.state.simTime = 0.2;
    await h.advance(1);
    expect(h.pixel(tileCX(6), tileCY(6))).toEqual(stand("node", 4));
    expect(nodeFrame(3, 0)).toBe(3);
    expect(nodeFrame(3, 0.2)).toBe(4);
    expect(nodeFrame(1, 5)).toBe(1);
  });

  it("draws the head, the body and the tail from their own pairs", async () => {
    await loadArt(stubAssets());
    startPlaying(h.debug);
    poseWorm(h.debug, 10, 8, 3);
    h.state.simTime = 0;
    await h.advance(1);
    expect(h.pixel(tileCX(10), tileCY(8))).toEqual(stand("worm", 0));
    expect(h.pixel(tileCX(9), tileCY(8))).toEqual(stand("worm", 2));
    expect(h.pixel(tileCX(8), tileCY(8))).toEqual(stand("worm", 4));
    // A quarter of a second in, the head pair is on its second frame (5 fps)
    // and the body and tail pairs are on theirs (6 fps).
    expect(segmentFrame(0, 3, 0.25)).toBe(1);
    expect(segmentFrame(1, 3, 0.25)).toBe(3);
    expect(segmentFrame(2, 3, 0.25)).toBe(5);
    // A worm of one segment is a head, drawn from the head pair alone.
    expect(segmentFrame(0, 1, 0)).toBe(0);
  });

  it("mirrors a worm heading left", async () => {
    await loadArt(stubAssets(true));
    startPlaying(h.debug);
    const right = poseWorm(h.debug, 10, 8, 1);
    await h.advance(1);
    const lightOnTheRight = h.pixel(tileCX(10) + 8, tileCY(8));
    expect(lightOnTheRight).toEqual([240, 230, 220]);
    expect(h.pixel(tileCX(10) - 8, tileCY(8))).toEqual([10, 20, 30]);

    h.debug.setWormHeading(right, -1);
    await h.advance(1);
    expect(h.pixel(tileCX(10) + 8, tileCY(8))).toEqual([10, 20, 30]);
    expect(h.pixel(tileCX(10) - 8, tileCY(8))).toEqual([240, 230, 220]);
  });

  it("draws the cursor and each foe from its own folder", async () => {
    await loadArt(stubAssets());
    startPlaying(h.debug);
    h.debug.setCursor(tileCX(20), 688);
    h.debug.addFoe("glitch", tileCX(4), tileCY(9));
    h.debug.addFoe("dropper", tileCX(8), tileCY(9));
    h.debug.addFoe("corruptor", tileCX(12), tileCY(3));
    const foes = h.debug.snapshot().foes;
    for (const foe of foes) {
      h.debug.setFoeMind(foe.id, false);
      h.debug.setFoeTravel(foe.id, false);
    }
    h.state.simTime = 0;
    await h.advance(1);
    expect(h.pixel(tileCX(20), 688)).toEqual(stand("cursor", 0));
    expect(h.pixel(tileCX(4), tileCY(9))).toEqual(stand("glitch", 0));
    expect(h.pixel(tileCX(8), tileCY(9))).toEqual(stand("dropper", 0));
    expect(h.pixel(tileCX(12), tileCY(3))).toEqual(stand("corruptor", 0));
  });

  it("draws a shape of its own where a frame did not arrive", async () => {
    startPlaying(h.debug);
    h.debug.setNode(4, 4, 3);
    await h.advance(1);
    const board = h.pixel(tileCX(20), tileCY(2));
    expect(h.pixel(tileCX(4), tileCY(4))).not.toEqual(board);
  });
});

describe("the arcs a discharge draws", () => {
  it("lights the line joining the two tiles it links", async () => {
    startPlaying(h.debug);
    h.debug.setNode(8, 6, 3);
    h.debug.setNode(10, 6, 1);
    h.debug.addBolt(tileCX(8), tileCY(6));
    await h.advance(1);
    expect(h.debug.snapshot().arcs).toHaveLength(1);
    const board = h.pixel(tileCX(20), tileCY(2));
    let lit = 0;
    for (let x = tileCX(8); x <= tileCX(10); x += 2) {
      for (let dy = -14; dy <= 14; dy += 2) {
        const seen = h.pixel(x, tileCY(6) + dy);
        if (seen[0] !== board[0] || seen[2] !== board[2]) lit += 1;
      }
    }
    expect(lit).toBeGreaterThan(20);
  });

  it("holds one shape for the arc's whole life", () => {
    const first = arcPolyline({ c: 3, r: 4 }, { c: 5, r: 4 });
    const again = arcPolyline({ c: 3, r: 4 }, { c: 5, r: 4 });
    expect(again).toEqual(first);
    expect(first[0]).toEqual({ x: tileCX(3), y: tileCY(4) });
    expect(first[first.length - 1]).toEqual({ x: tileCX(5), y: tileCY(4) });
    const other = arcPolyline({ c: 3, r: 4 }, { c: 3, r: 6 });
    expect(other).not.toEqual(first);
  });

  it("is gone from the picture once its life has run out", async () => {
    startPlaying(h.debug);
    h.debug.setNode(8, 6, 3);
    h.debug.setNode(10, 6, 1);
    h.debug.addBolt(tileCX(8), tileCY(6));
    await h.advance(1);
    await h.seconds(ARC_LIFE + 1 / 60);
    expect(h.debug.snapshot().arcs).toHaveLength(0);
  });
});

describe("the regions of the stage", () => {
  it("keeps the board's own drawing below the HUD bar", async () => {
    startPlaying(h.debug);
    h.debug.setNode(4, 0, 3);
    await h.advance(1);
    // The HUD bar's ground, above the board, is untouched by the field.
    const inBar = h.pixel(tileCX(4), BOARD_Y - 20);
    const onNode = h.pixel(tileCX(4), tileCY(0));
    expect(inBar).not.toEqual(onNode);
  });
});
