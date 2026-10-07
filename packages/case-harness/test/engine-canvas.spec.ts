// The canvas an engine harness draws into, and the recorder over it.

import { expect, it } from "vitest";
import {
  createRecordingCanvas,
  rasterize,
  recordingContext,
} from "../src/engine/canvas";
import { callsTo, imageRef, setsOf } from "../src/draw-calls";
import { textDraws } from "../src/text";

const SHAPE = { cssWidth: 200, cssHeight: 100, dpr: 1 };

it("sizes the backing store in DEVICE pixels", () => {
  const surface = createRecordingCanvas({
    cssWidth: 200,
    cssHeight: 100,
    dpr: 2,
  });
  expect(surface.canvas.width).toBe(400);
  expect(surface.canvas.height).toBe(200);
});

it("hands the engine an element whose getContext is the recorder", () => {
  const surface = createRecordingCanvas(SHAPE);
  const ctx = surface.element.getContext("2d");
  expect(ctx).not.toBe(surface.ctx);
  (ctx as unknown as { fillRect(...a: number[]): void }).fillRect(0, 0, 4, 4);
  expect(callsTo(surface.calls, "fillRect")).toEqual([[0, 0, 4, 4]]);
});

it("records calls and property sets in the order the render made them", () => {
  const surface = createRecordingCanvas(SHAPE);
  const ctx = surface.element.getContext("2d") as unknown as {
    fillStyle: string;
    fillRect(...a: number[]): void;
  };
  ctx.fillStyle = "#123456";
  ctx.fillRect(1, 2, 3, 4);
  expect(surface.calls).toEqual([
    { kind: "set", property: "fillStyle", value: "#123456" },
    { kind: "call", method: "fillRect", args: [1, 2, 3, 4] },
  ]);
  expect(setsOf(surface.calls, "fillStyle")).toEqual(["#123456"]);
});

it("really draws: the pixels are on the canvas the calls went through", () => {
  const surface = createRecordingCanvas(SHAPE);
  const ctx = surface.element.getContext("2d") as unknown as {
    fillStyle: string;
    fillRect(...a: number[]): void;
  };
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 10, 10);
  const { data } = surface.ctx.getImageData(5, 5, 1, 1);
  expect([data[0], data[1], data[2]]).toEqual([255, 0, 0]);
});

it("measures text only when the case asked, and carries the transform it was drawn under", () => {
  const bare = createRecordingCanvas(SHAPE);
  const bareCtx = bare.element.getContext("2d") as unknown as {
    fillText(text: string, x: number, y: number): void;
  };
  bareCtx.fillText("HELLO", 10, 20);
  expect(bare.calls[0]?.kind === "call" && bare.calls[0].text).toBeUndefined();

  const measured = createRecordingCanvas(SHAPE, { measureText: true });
  const ctx = measured.element.getContext("2d") as unknown as {
    textAlign: string;
    translate(x: number, y: number): void;
    fillText(text: string, x: number, y: number): void;
  };
  ctx.textAlign = "center";
  ctx.translate(100, 50);
  ctx.fillText("HELLO", 0, 0);
  const call = measured.calls.at(-1);
  if (call?.kind !== "call" || call.text === undefined) {
    throw new Error("expected a measured text call");
  }
  expect(call.text.textAlign).toBe("center");
  expect(call.text.width).toBeGreaterThan(0);
  // The transform the CONTEXT held, taken from the context rather than
  // reconstructed: the translate is in it.
  expect(call.text.transform).toEqual([1, 0, 0, 1, 100, 50]);
});

it("a recorded transform places a draw that an operation walk could not", () => {
  const measured = createRecordingCanvas(SHAPE, { measureText: true });
  const ctx = measured.element.getContext("2d") as unknown as {
    setTransform(
      a: number,
      b: number,
      c: number,
      d: number,
      e: number,
      f: number,
    ): void;
    fillText(text: string, x: number, y: number): void;
  };
  ctx.setTransform(2, 0, 0, 2, 30, 40);
  ctx.fillText("X", 5, 5);
  const [draw] = textDraws(measured.calls);
  expect(draw?.x).toBe(40);
  expect(draw?.y).toBe(50);
});

it("interning replaces the bitmap in the RECORD and keeps the real one aside", () => {
  const surface = createRecordingCanvas(SHAPE, { internImages: true });
  const source = createRecordingCanvas(
    { cssWidth: 8, cssHeight: 8, dpr: 1 },
    {},
  ).canvas;
  const ctx = surface.element.getContext("2d") as unknown as {
    drawImage(image: unknown, x: number, y: number): void;
  };
  ctx.drawImage(source, 0, 0);
  ctx.drawImage(source, 4, 4);

  const [first, second] = callsTo(surface.calls, "drawImage");
  const ref = imageRef(first?.[0]);
  expect(ref).not.toBeNull();
  expect(ref?.width).toBe(8);
  expect(ref?.height).toBe(8);
  // The same source drawn twice is ONE id, which is what makes a sprite
  // identifiable across frames.
  expect(imageRef(second?.[0])?.id).toBe(ref?.id);
  expect(surface.images.get(ref?.id as number)).toBe(source);
});

it("interning changes what is recorded and never what is drawn", () => {
  const surface = createRecordingCanvas(SHAPE, { internImages: true });
  const patch = createRecordingCanvas({ cssWidth: 4, cssHeight: 4, dpr: 1 });
  const patchCtx = patch.element.getContext("2d") as unknown as {
    fillStyle: string;
    fillRect(...a: number[]): void;
  };
  patchCtx.fillStyle = "#00ff00";
  patchCtx.fillRect(0, 0, 4, 4);

  const ctx = surface.element.getContext("2d") as unknown as {
    drawImage(image: unknown, x: number, y: number): void;
  };
  ctx.drawImage(patch.canvas, 0, 0);
  const { data } = surface.ctx.getImageData(1, 1, 1, 1);
  expect([data[0], data[1], data[2]]).toEqual([0, 255, 0]);
});

it("a non-image first argument is left alone even when interning is on", () => {
  // Over a stub target rather than a real context, because a real one refuses a
  // `drawImage` of anything that is not a source before the record could be
  // read. What is under test is the RECORD: a call whose first argument names no
  // bitmap must be written down exactly as it was made.
  const calls: import("../src/draw-calls").DrawCall[] = [];
  const target = {
    drawImage: (): void => undefined,
  } as unknown as import("@napi-rs/canvas").SKRSContext2D;
  const recorded = recordingContext(target, calls, {
    internImages: true,
  }) as unknown as { drawImage(image: unknown, x: number, y: number): void };
  recorded.drawImage(null, 0, 0);
  recorded.drawImage({ width: "wide" }, 1, 1);
  expect(callsTo(calls, "drawImage")[0]?.[0]).toBeNull();
  expect(callsTo(calls, "drawImage")[1]?.[0]).toEqual({ width: "wide" });
});

it("a bare recorder can be installed over a context a caller already holds", () => {
  const surface = createRecordingCanvas(SHAPE);
  const calls: import("../src/draw-calls").DrawCall[] = [];
  const recorded = recordingContext(surface.ctx, calls) as unknown as {
    beginPath(): void;
  };
  recorded.beginPath();
  expect(calls).toEqual([{ kind: "call", method: "beginPath", args: [] }]);
});

it("rasterizes a colour string through the canvas a check samples with", () => {
  expect(rasterize("#0a141e")).toEqual([10, 20, 30]);
  // A translucent colour converges on its own channels, as the engine's
  // frame-over-frame clear leaves it.
  expect(rasterize("rgba(255, 0, 0, 0.5)")).toEqual([255, 0, 0]);
});
