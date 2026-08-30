import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it } from "vitest";
import { clearTrailSurface, platformTrail } from "./trail";
import { nodeTrail } from "./harness.test-support";

const globals = globalThis as unknown as {
  OffscreenCanvas?: unknown;
  document?: unknown;
};

afterEach(() => {
  delete globals.OffscreenCanvas;
  delete globals.document;
});

describe("the painted layer's surface", () => {
  it("has nothing to offer where the platform makes no canvas", () => {
    expect(platformTrail(1280, 720)).toBeNull();
  });

  it("takes an OffscreenCanvas where the browser has one", () => {
    globals.OffscreenCanvas = class {
      constructor(width: number, height: number) {
        return createCanvas(width, height) as unknown as object;
      }
    };
    const surface = platformTrail(64, 32);
    expect(surface).not.toBeNull();
    expect(surface?.width).toBe(64);
  });

  it("falls back to a detached canvas element", () => {
    globals.document = {
      createElement: (tag: string) => {
        if (tag !== "canvas") throw new Error(`no element ${tag}`);
        return createCanvas(1, 1);
      },
    };
    const surface = platformTrail(48, 24);
    expect(surface).not.toBeNull();
    expect(surface?.height).toBe(24);
  });

  it("survives a platform whose canvas refuses to be made", () => {
    globals.OffscreenCanvas = class {
      constructor() {
        throw new Error("no offscreen here");
      }
    };
    globals.document = {
      createElement: () => {
        throw new Error("no elements here");
      },
    };
    expect(platformTrail(10, 10)).toBeNull();
  });

  it("wipes what it holds, and shrugs at having no surface at all", () => {
    const surface = nodeTrail(20, 20);
    surface.ctx.fillStyle = "#ffffff";
    surface.ctx.fillRect(0, 0, 20, 20);
    expect(surface.ctx.getImageData(5, 5, 1, 1).data[3]).toBe(255);
    clearTrailSurface(surface);
    expect(surface.ctx.getImageData(5, 5, 1, 1).data[3]).toBe(0);
    expect(() => clearTrailSurface(null)).not.toThrow();
  });
});
