// Floe — the seeded art, loaded the way the produced site loads it.
//
// `src/render.test.ts` reads the seeded PNGs off disk and hands them to the render
// directly, so what it asserts is the DRAWING. This file asserts the other half:
// that the paths this build asks the ENGINE'S OWN LOADER for reach the seeded
// tree, and that what comes back is the art at the frame sizes `specs/assets.md`
// tabulates.
//
// The loader resolves every path under the fixed `assets/` root, relative to the
// page the build is served from, and then fetches and decodes it. A Node process
// has no page to resolve that relative URL against, so the two globals the loader
// reaches for are stood up over this project's own `assets/` directory for the
// life of this file and put back afterwards. That is the same kind of thing the
// canvas and the surface metrics are: the host the engine runs on. In a browser
// the same two paths are served by `dist/assets/`, which `vite.config.ts` copies
// the tree into.

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type SurfaceMetrics,
} from "@test-cabinet/simple-2d";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BEAR_FRAMES,
  CROSSER_FRAMES,
  LAYOUT,
  RAFT_FRAMES,
  SPRITE_TILE,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  CAR_W,
  DOGSLED_W,
  PAN_W,
  PLOW_W,
  RAFT_W,
} from "./constants";
import type { Sprites } from "./assets";
import { BACKGROUND, game, type FloeDebugApi, type FloeState } from "./game";

/** The two globals the loader reaches for, as slots this file may write. */
const host = globalThis as unknown as {
  fetch: unknown;
  createImageBitmap: unknown;
};
let realFetch: unknown;
let realDecode: unknown;

beforeAll(() => {
  realFetch = host.fetch;
  realDecode = host.createImageBitmap;
  host.fetch = async (url: string): Promise<Response> =>
    new Response(readFileSync(join(process.cwd(), url)));
  host.createImageBitmap = async (blob: Blob): Promise<unknown> =>
    loadImage(Buffer.from(await blob.arrayBuffer()));
});

afterAll(() => {
  host.fetch = realFetch;
  host.createImageBitmap = realDecode;
});

/** The engine, stood up exactly as `src/main.ts` stands it up. */
async function initialized(): Promise<{
  sprites: Sprites;
  destroy: () => void;
}> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx as SKRSContext2D,
  }) as unknown as HTMLCanvasElement;
  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };
  const engine = createEngine<FloeState, FloeDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(1000 / TICK_HZ),
    surface,
  });
  await engine.initialize();
  return {
    sprites: engine.state.sprites as Sprites,
    destroy: () => {
      engine.destroy();
    },
  };
}

describe("the seeded art, through the engine's loader", () => {
  it("loads every frame of every folder at the size specs/assets.md tabulates", async () => {
    const { sprites, destroy } = await initialized();
    try {
      const expected: readonly [keyof Sprites, number, number, number][] = [
        ["crosser", CROSSER_FRAMES, SPRITE_TILE, SPRITE_TILE],
        ["bear", BEAR_FRAMES, SPRITE_TILE, SPRITE_TILE],
        ["plow", 1, PLOW_W, SPRITE_TILE],
        ["dogsled", 1, DOGSLED_W, SPRITE_TILE],
        ["car", 1, CAR_W, SPRITE_TILE],
        ["pan", 1, PAN_W, SPRITE_TILE],
        ["raft", RAFT_FRAMES, RAFT_W, SPRITE_TILE],
      ];
      for (const [name, count, width, height] of expected) {
        const frames = sprites[name];
        expect(frames, name).toHaveLength(count);
        for (const frame of frames) {
          expect(frame, name).not.toBeNull();
          expect(frame?.width, name).toBe(width);
          expect(frame?.height, name).toBe(height);
        }
      }
    } finally {
      destroy();
    }
  });

  it("reaches the same bytes the seeded tree holds", async () => {
    const { sprites, destroy } = await initialized();
    try {
      // A frame drawn back out and compared against the PNG read straight off
      // disk: a build that decoded some other file, or painted one of its own,
      // could not match here.
      const seeded = await loadImage(
        readFileSync(join("assets", "bear", "0.png")),
      );
      const shot = (image: unknown): Uint8ClampedArray => {
        const canvas = createCanvas(SPRITE_TILE, SPRITE_TILE);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image as never, 0, 0);
        return ctx.getImageData(0, 0, SPRITE_TILE, SPRITE_TILE).data;
      };
      expect([...shot(sprites.bear[0])]).toEqual([...shot(seeded)]);
    } finally {
      destroy();
    }
  });
});
