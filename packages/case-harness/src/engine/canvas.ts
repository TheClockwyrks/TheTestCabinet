// The canvas an engine harness draws into, and the recorder over it. 2D ONLY.
//
// Under an engine there is no page, so there is no `<canvas>` either. What every
// 2D engine harness builds instead is a `@napi-rs/canvas` surface — a real
// rasterizer with a real 2D context — dressed as an `HTMLCanvasElement` well
// enough for the engine to take it: a `style` object it may write to, and a
// `getContext` that hands back the RECORDING proxy rather than the raw context.
//
// THE PROXY IS WHY ONE FRAME ANSWERS TWO QUESTIONS. Everything the engine and the
// build draw goes through it, so a frame leaves both a pixel buffer a check can
// sample and an ordered list of the operations that produced it. The engine reads
// its context off the element the harness handed it, so the engine's own
// diagnostics overlay lands in the same list as the build's render — which is
// what lets an overlay check read the overlay's text off the calls.
//
// WHAT IS RECORDED IS THE CASE'S CHOICE, and both extras cost a case that does not
// ask for them nothing:
//
//   - `measureText` records, at the moment of each text call, the transform in
//     force, the run's measured width under the font in force, and the alignment
//     that places it about its anchor. Without it a text draw is a point, which is
//     exactly what a case that never measured was already reading. See
//     `../text`, whose readings use the recorded transform when it is there and
//     walk the operation list for it when it is not.
//   - `internImages` replaces a bitmap argument in the RECORD with an
//     `{ $src: ImageRef }` naming it, so a check identifies a sprite by the image
//     drawn rather than by matching a path. The real source is passed through to
//     the context untouched, and is kept beside the recorder so a check that wants
//     its pixels can find it. This is the same shape `../draw-calls`'s `imageRef`
//     already reads under no engine, so the readings over it are shared.
//
// THIS MODULE IS 2D-ONLY and nothing neutral imports it. A 3D case's harness never
// makes a 2D context and never wants one; see `./index` on the layering.

import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { DrawCall, ImageRef } from "../draw-calls";
import type { Matrix } from "../matrix";
import type { SurfaceShape } from "./events";

/** What a recording context keeps beside the calls it recorded. */
export interface RecorderOptions {
  /**
   * Measure each text call and record the transform in force at it.
   *
   * The transform is taken from the context itself (`getTransform`) rather than
   * reconstructed from the operation list, so it is exact under any pipeline the
   * engine applies — including the `setTransform` an engine's own fit issues, and
   * a `reset` an operation walk cannot see through.
   */
  measureText?: boolean;
  /** Replace a bitmap argument in the record with an {@link ImageRef} naming it. */
  internImages?: boolean;
  /**
   * Whether the recorder is installed at all. Defaults to `true`.
   *
   * A check that reads what the build DREW needs the call log, and a check that
   * reads what the build DID does not. Recording is not free: every method the
   * pipeline calls and every property it sets passes through a proxy that
   * allocates a record of it, which on a busy frame is a sizeable share of the
   * frame's cost. Over the thousands of frames a long drive spends, that is a
   * share of the drive paid for a log the check never opens, so a drive turns it
   * off and {@link RecordingCanvas.calls} stays empty.
   */
  record?: boolean;
}

/** Which images a frame drew, by the id the record names them under. */
export type ImageSources = ReadonlyMap<number, object>;

/** A canvas, its context, and everything the recorder over it kept. */
export interface RecordingCanvas {
  /** The real canvas, holding the last frame that ran. */
  readonly canvas: Canvas;
  /** The real context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * Every call and property set the render made, oldest first.
   *
   * Empty on a canvas built with `record: false`, which is what a check that
   * drives thousands of frames and reads none of them asks for.
   */
  readonly calls: DrawCall[];
  /** The element the engine is handed, whose `getContext` is the proxy. */
  readonly element: HTMLCanvasElement;
  /** The real bitmap behind each interned {@link ImageRef} id. */
  readonly images: ImageSources;
}

/** The next id an interned image takes, across every canvas in this worker. */
let nextImageId = 1;

/** Ids are identity WITHIN ONE WORKER: the same source drawn twice is one id. */
const imageIds = new WeakMap<object, number>();

/** A stable, short digest of a source's `src`, which may be a whole inlined file. */
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** How long a `src` may be and still be written into the record verbatim. */
const MAX_RECORDED_SRC = 200;

/** Whether `value` is something a 2D context can draw as an image. */
function drawableSource(value: unknown): value is object {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { width?: unknown; height?: unknown };
  return (
    typeof candidate.width === "number" && typeof candidate.height === "number"
  );
}

/** The {@link ImageRef} for a drawn source, minting one the first time it is seen. */
function refFor(value: object, sources: Map<number, object>): ImageRef {
  let id = imageIds.get(value);
  if (id === undefined) {
    id = nextImageId;
    nextImageId += 1;
    imageIds.set(value, id);
  }
  sources.set(id, value);
  const held = value as {
    width: number;
    height: number;
    src?: unknown;
    data?: unknown;
  };
  const src = typeof held.src === "string" ? held.src : null;
  return {
    id,
    kind: held.data === undefined ? "bitmap" : "pixels",
    name: value.constructor?.name ?? "Object",
    width: held.width,
    height: held.height,
    src: src !== null && src.length <= MAX_RECORDED_SRC ? src : null,
    srcHash: src === null ? null : hashString(src),
  };
}

/** The methods whose FIRST argument is a bitmap source. */
const IMAGE_METHODS = new Set([
  "drawImage",
  "createPattern",
  "putImageData",
  "texImage2D",
]);

/**
 * A proxy that records every call and property set on its way to the real
 * context.
 *
 * A property that is not a function comes back as it is, so a check reading
 * `ctx.canvas` or the current `fillStyle` off the proxy reads the real one. Every
 * call is forwarded to the real context with the CALLER's arguments — interning
 * rewrites what is recorded and never what is drawn.
 */
export function recordingContext(
  target: SKRSContext2D,
  calls: DrawCall[],
  options: RecorderOptions = {},
  sources: Map<number, object> = new Map(),
): SKRSContext2D {
  const measure = options.measureText === true;
  const intern = options.internImages === true;
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
        const recorded =
          intern && IMAGE_METHODS.has(method) && drawableSource(args[0])
            ? [{ $src: refFor(args[0], sources) }, ...args.slice(1)]
            : args;
        const call: DrawCall = { kind: "call", method, args: recorded };
        if (
          measure &&
          (method === "fillText" || method === "strokeText") &&
          typeof args[0] === "string"
        ) {
          const m = object.getTransform();
          call.text = {
            transform: [m.a, m.b, m.c, m.d, m.e, m.f] as Matrix,
            width: object.measureText(args[0]).width,
            textAlign: object.textAlign,
          };
        }
        calls.push(call);
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/**
 * A canvas of the given shape, with a recorder installed, dressed as the element
 * an engine takes.
 *
 * The backing store is `cssWidth * dpr` by `cssHeight * dpr`, rounded, which is
 * what a browser gives an element of that shape at that ratio — so a check that
 * runs at a non-default shape reads the pixels the engine's own fit would have
 * put there in a page.
 */
export function createRecordingCanvas(
  shape: SurfaceShape,
  options: RecorderOptions = {},
): RecordingCanvas {
  const canvas = createCanvas(
    Math.round(shape.cssWidth * shape.dpr),
    Math.round(shape.cssHeight * shape.dpr),
  );
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const images = new Map<number, object>();
  const recorded =
    (options.record ?? true)
      ? recordingContext(ctx, calls, options, images)
      : ctx;
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: (): SKRSContext2D => recorded,
  }) as unknown as HTMLCanvasElement;
  return { canvas, ctx, calls, element, images };
}

/**
 * A colour string rasterized through the same canvas implementation a check
 * samples with.
 *
 * What an engine clears the frame to, read back as the pixel a check will
 * actually meet — which is the only honest thing to compare a patch nothing was
 * drawn over against. The fill is repeated rather than applied once so a
 * TRANSLUCENT colour reads as the engine leaves it: the engine composites its
 * clear over the previous frame every frame, which converges on the colour's own
 * channels, and a single fill over a transparent canvas would not.
 */
export function rasterize(
  color: string,
  passes = 255,
): [number, number, number] {
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.fillStyle = color;
  for (let i = 0; i < passes; i += 1) ctx.fillRect(0, 0, 1, 1);
  const { data } = ctx.getImageData(0, 0, 1, 1);
  return [data[0] as number, data[1] as number, data[2] as number];
}
