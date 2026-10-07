// The seeded art, drawn for real.
//
// The engine's loader reaches for `fetch` and `createImageBitmap`, and a Node
// process has neither a page to resolve a relative URL against nor a decoder. So
// this file stands both globals up over the project's own `assets/` directory
// for its own length and restores them afterwards, which makes the paths this
// build asks for the paths the produced site serves, and makes the pixels below
// the pixels the seeded frames actually carry.

/// <reference types="node" />
// This file is the Node half of the build: it reads the seeded art off disk and
// draws through a Node canvas. The project compiles with `"types": []`, so the
// Node type definitions it needs are named here rather than picked up by
// accident from a dependency that happens to reference them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LAYOUT, STAGE_H, STAGE_W, tileCX, tileCY } from "./constants";
import {
  BACKGROUND,
  game,
  type WirewormDebugApi,
  type WirewormState,
} from "./game";

const PROJECT = fileURLToPath(new URL("..", import.meta.url));

interface Host {
  fetch?: unknown;
  createImageBitmap?: unknown;
}

const host = globalThis as unknown as Host;
const realFetch = host.fetch;
const realDecode = host.createImageBitmap;

beforeAll(() => {
  host.fetch = async (url: string): Promise<Response> =>
    new Response(readFileSync(join(PROJECT, url)));
  host.createImageBitmap = async (blob: Blob): Promise<unknown> =>
    loadImage(Buffer.from(await blob.arrayBuffer()));
});

afterAll(() => {
  host.fetch = realFetch;
  host.createImageBitmap = realDecode;
});

describe("drawing from the seeded art", () => {
  it("loads every frame under the assets root and draws the board from it", async () => {
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

    const engine = createEngine<WirewormState, WirewormDebugApi>({
      canvas: element,
      width: STAGE_W,
      height: STAGE_H,
      game,
      background: BACKGROUND,
      layout: LAYOUT,
      clock: new ConstantClock(1000 / 60),
      surface,
    });

    const loaded: string[] = [];
    const failed: string[] = [];
    engine.events.on("asset:loaded", ({ path }) => loaded.push(path));
    engine.events.on("asset:failed", ({ path }) => failed.push(path));

    await engine.initialize();
    expect(failed).toEqual([]);
    expect(loaded).toHaveLength(21);
    expect(loaded).toContain("node/0.png");

    const debug = engine.debug;
    engine.apply((s) => debug.clearNodes(s));
    engine.apply((s) => debug.clearWorms(s));
    engine.apply((s) => debug.setScreen(s, "playing"));
    engine.apply((s) => debug.setPhase(s, "active"));
    engine.apply((s) => debug.setNode(s, 6, 6, 0));
    engine.apply((s) => debug.setNode(s, 9, 6, 3));
    engine.apply((s) => debug.addWorm(s, 12, 6));
    engine.apply((s) => debug.addFoe(s, "corruptor", tileCX(20), tileCY(6)));
    await engine.advance(1);

    const at = (x: number, y: number): string =>
      [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data]
        .slice(0, 3)
        .join(",");
    const empty = at(tileCX(30), tileCY(6));

    // Each drawn element leaves pixels of its own, apart from the bare board.
    expect(at(tileCX(6), tileCY(6))).not.toBe(empty);
    expect(at(tileCX(9), tileCY(6))).not.toBe(empty);
    expect(at(tileCX(12), tileCY(6))).not.toBe(empty);
    expect(at(tileCX(20), tileCY(6))).not.toBe(empty);

    // The charge ramp reads as a ramp: critical is brighter than inert.
    const brightness = (rgb: string): number =>
      rgb.split(",").reduce((sum, part) => sum + Number(part), 0);
    expect(brightness(at(tileCX(9), tileCY(6)))).toBeGreaterThan(
      brightness(at(tileCX(6), tileCY(6))),
    );

    engine.destroy();
  });
});
