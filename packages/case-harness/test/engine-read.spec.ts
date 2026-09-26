// The synchronous readings an engine harness takes off its own canvas.
//
// These are the twins of `../src/color`'s browser-side readings, and the point
// of the split is that they are SYNCHRONOUS: under an engine the canvas is in
// this process, so a check reads a colour without an `await`. What must not
// differ is the arithmetic, which is why every pure part is imported from the
// shared module rather than restated here — the first check below is the one
// that would catch it if that stopped being true.

import { expect, it } from "vitest";
import { createRecordingCanvas } from "../src/engine/canvas";
import {
  allInLogical,
  canvasPixels,
  canvasRect,
  deviceOf,
  inLogical,
  pixelAt,
  pixelsAt,
  pixelsChanged,
  sampleColor,
  samplePoints,
  sampleRing,
} from "../src/engine/read";
import { clusterPoints, meanOf, pixelsDiffering, type Rgb } from "../src/color";
import type { Pixel } from "../src/pixels";
import type { EngineViewport } from "../src/engine/contract";

const SHAPE = { cssWidth: 40, cssHeight: 20, dpr: 1 };
const IDENTITY: EngineViewport = {
  width: 40,
  height: 20,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

function painted(color: string) {
  const surface = createRecordingCanvas(SHAPE);
  const ctx = surface.element.getContext("2d") as unknown as {
    fillStyle: string;
    fillRect(...a: number[]): void;
  };
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 40, 20);
  return surface;
}

/** A reader of one flat colour, which is all a cluster reading needs. */
function readerOf(pixel: Pixel): { pixel(): Pixel } {
  return { pixel: () => pixel };
}

it("addresses a logical point through the engine's fit, in whole pixels", () => {
  expect(deviceOf(IDENTITY, 3, 4)).toEqual({ x: 3, y: 4 });
  expect(
    deviceOf({ ...IDENTITY, scale: 2, offsetX: 5, offsetY: 7 }, 3, 4),
  ).toEqual({ x: 11, y: 15 });
  // A backing store is addressed in whole pixels, so a fractional ask rounds
  // rather than leaving `getImageData` to choose.
  expect(deviceOf({ ...IDENTITY, scale: 1.5 }, 3, 3)).toEqual({ x: 5, y: 5 });
});

it("reads the pixel that is really there", () => {
  const surface = painted("#204060");
  expect(pixelAt(surface.ctx, { x: 10, y: 10 })).toEqual([32, 64, 96, 255]);
});

it("refuses a point off the backing store, naming it and the surface", () => {
  const surface = painted("#204060");
  // The library's own answer to any of these is `Read pixels from canvas
  // failed`, which names neither the point nor the surface and reaches a suite
  // as a bare failure with no expected and no actual.
  for (const at of [
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 40, y: 0 },
    { x: 0, y: 20 },
  ]) {
    expect(() => pixelAt(surface.ctx, at)).toThrow(
      new RegExp(`\\(${String(at.x)}, ${String(at.y)}\\).*40 by 20`),
    );
  }
  // The last pixel of each axis is still on it.
  expect(pixelAt(surface.ctx, { x: 39, y: 19 })).toEqual([32, 64, 96, 255]);
});

it("samples a cluster, and agrees with the shared arithmetic exactly", () => {
  const reader = readerOf([10, 20, 30, 255]);
  const sampled = sampleColor(reader, 5, 5);
  expect(sampled).toEqual({ r: 10, g: 20, b: 30 });
  // The same mean over the same cluster the browser-side reading takes.
  expect(sampled).toEqual(meanOf(pixelsAt(reader, clusterPoints(5, 5, 4))));
});

it("a cluster really is five points, at the radius the caller named", () => {
  const seen: number[][] = [];
  const reader = {
    pixel: (x: number, y: number): Pixel => {
      seen.push([x, y]);
      return [0, 0, 0, 255];
    },
  };
  sampleColor(reader, 100, 50, 6);
  expect(seen).toEqual([
    [100, 50],
    [106, 50],
    [94, 50],
    [100, 56],
    [100, 44],
  ]);
});

it("samples a ring and a run of points", () => {
  const reader = readerOf([8, 8, 8, 255]);
  expect(sampleRing(reader, 5, 5, 3)).toEqual({ r: 8, g: 8, b: 8 });
  expect(
    samplePoints(reader, [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]),
  ).toEqual<Rgb[]>([
    { r: 8, g: 8, b: 8 },
    { r: 8, g: 8, b: 8 },
  ]);
});

it("copies the whole backing store, so two frames can be held apart", () => {
  const surface = painted("#000000");
  const before = canvasPixels(surface);
  const ctx = surface.element.getContext("2d") as unknown as {
    fillStyle: string;
    fillRect(...a: number[]): void;
  };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 4, 4);
  const after = canvasPixels(surface);
  // The earlier capture is untouched by the later drawing: it is a copy.
  expect(before[0]).toBe(0);
  expect(after[0]).toBe(255);
  // 4 x 4 pixels, three channels each moved; alpha was already opaque.
  expect(pixelsChanged(before, after)).toBe(4 * 4 * 3);
});

it("two captures of different lengths differ by the whole of the difference", () => {
  expect(
    pixelsChanged(
      Uint8ClampedArray.from([1, 2, 3]),
      Uint8ClampedArray.from([1, 2, 3, 4, 5]),
    ),
  ).toBe(2);
});

it("counts BYTES, where the shared rectangle reading counts pixels", () => {
  const surface = painted("#000000");
  const before = canvasRect(surface);
  const ctx = surface.element.getContext("2d") as unknown as {
    fillStyle: string;
    fillRect(...a: number[]): void;
  };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 4, 4);
  const after = canvasRect(surface);
  // Sixteen pixels moved; forty-eight bytes did. A threshold stated over one is
  // meaningless over the other, which is why both readings ship.
  expect(pixelsDiffering(before, after)).toBe(16);
  expect(pixelsChanged(before.data, after.data)).toBe(48);
});

it("restates a canvas-pixel text reading in the case's logical units", () => {
  const view: EngineViewport = {
    width: 40,
    height: 20,
    scale: 2,
    offsetX: 10,
    offsetY: 6,
  };
  const draw = { text: "HI", x: 30, y: 26, left: 20, right: 50 };
  expect(inLogical(view, draw)).toEqual({
    text: "HI",
    x: 10,
    y: 10,
    left: 5,
    right: 20,
  });
  expect(allInLogical(view, [draw])).toEqual([inLogical(view, draw)]);
});

it("the conversion is the identity at the harness's default shape", () => {
  const draw = { text: "HI", x: 3, y: 4, left: 1, right: 9, align: "center" };
  expect(inLogical(IDENTITY, draw)).toEqual(draw);
});
