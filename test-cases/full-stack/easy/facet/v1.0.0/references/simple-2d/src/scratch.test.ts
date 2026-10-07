import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScratchCanvas,
  domScratchCanvas,
  setScratchCanvasFactory,
} from "./scratch";

const globals = globalThis as Record<string, unknown>;
const undo: (() => void)[] = [];

/** Install a global for one check, and take it away again afterwards. */
function stub(name: string, value: unknown): void {
  const had = name in globals;
  const previous = globals[name];
  globals[name] = value;
  undo.push(() => {
    if (had) globals[name] = previous;
    else delete globals[name];
  });
}

afterEach(() => {
  while (undo.length > 0) undo.pop()?.();
});

describe("the browser's factory", () => {
  it("answers null where the host can make no canvas at all", () => {
    // Node has neither an OffscreenCanvas nor a document, which is exactly the
    // case the presentation reads as "no burst".
    expect(domScratchCanvas(32, 32)).toBeNull();
  });

  it("prefers an OffscreenCanvas, sized as asked", () => {
    class FakeOffscreen {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return { canvas: this };
      }
    }
    stub("OffscreenCanvas", FakeOffscreen);
    const ctx = domScratchCanvas(48, 24);
    expect(ctx?.canvas).toMatchObject({ width: 48, height: 24 });
  });

  it("reports an OffscreenCanvas that yields no context as no canvas", () => {
    class Refusing {
      getContext() {
        return null;
      }
    }
    stub("OffscreenCanvas", Refusing);
    expect(domScratchCanvas(16, 16)).toBeNull();
  });

  it("falls back to a detached canvas element, never appending it", () => {
    const made: { width: number; height: number }[] = [];
    stub("document", {
      createElement: () => {
        const element = {
          width: 0,
          height: 0,
          getContext: () => ({ element }),
        };
        made.push(element);
        return element;
      },
    });
    const ctx = domScratchCanvas(64, 96);
    expect(ctx).not.toBeNull();
    expect(made).toEqual([expect.objectContaining({ width: 64, height: 96 })]);
  });
});

describe("the replaceable factory", () => {
  it("hands out whatever is installed, and puts the previous one back", () => {
    const restore = setScratchCanvasFactory(
      (width, height) =>
        createCanvas(width, height).getContext(
          "2d",
        ) as unknown as CanvasRenderingContext2D,
    );
    const ctx = createScratchCanvas(80, 40);
    expect(ctx?.canvas.width).toBe(80);
    expect(ctx?.canvas.height).toBe(40);

    restore();
    expect(createScratchCanvas(80, 40)).toBeNull();
  });
});
