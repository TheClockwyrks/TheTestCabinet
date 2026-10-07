// Spectra — clearing the frames nobody will look at. CASE-PROVIDED.
//
// WHAT THIS IS FOR. `@napi-rs/canvas` rasterises nothing until someone asks for
// pixels, and when they do it renders every operation the canvas has taken since
// it last had reason to forget them. A `ctx.filter` chain is what makes that bill
// enormous: the canvas applies a filter over the WHOLE backing store for every
// filtered draw, so a build that tints a 28-unit sprite through
// `grayscale(1) brightness(1.1) sepia(1) hue-rotate(290deg) saturate(7)` pays for
// a 1280x720 filter pass per sprite, on every frame it has ever drawn, at the
// single `toBuffer` inside `captureStill`. Measured here at twenty filtered
// sprites a frame, that one call costs 0.23 s after one frame and 59.6 s after
// three hundred; the same run without the filter costs 18 ms and 38 ms. A
// validator that captures one still therefore runs for minutes and is cut short,
// and a build is marked down for colouring a sprite the way the platform offers.
//
// A CANVAS THAT IS CLEARED FORGETS. `clearRect` over the whole backing store
// discards every operation recorded before it, because nothing recorded before it
// can be seen afterwards. `fillRect` over the whole backing store in an opaque
// colour hides just as much and discards nothing, and that is exactly what a
// frame opens with: both engines paint the stage background that way when a build
// declares one, and so does an engineless build that fills its stage rather than
// clearing it.
//
// SO THE HARNESS CLEARS FIRST. A fill this module can PROVE covers the whole
// backing store opaquely is preceded by a full-canvas `clearRect`. The pixels are
// what they were, because the fill that follows covers every pixel the clear
// removed, and the canvas is free of everything the frames before it drew. The
// twenty-sprite run above then costs 0.22 s at three hundred frames instead of
// 59.6 s, and every capture reads the same bytes it read before.
//
// WHAT COUNTS AS A PROOF. All of these, or the fill is forwarded untouched:
//
//   - The rectangle covers the backing store. Its four corners are taken through
//     the current transform, which must be axis-aligned for a rectangle to stay
//     one.
//   - The colour is opaque. It is MEASURED rather than parsed — the style is
//     painted onto a probe pixel and its alpha read back — so a named colour, an
//     `hsl`, an `oklch` and a hex with an alpha channel are all decided by what
//     the canvas does with them rather than by what this module knows about CSS.
//     A gradient or a pattern is never a proof.
//   - Nothing between the fill and the backing store can thin it: `globalAlpha`
//     is 1, the filter is `none`, and the composite operator is one that replaces
//     what it covers.
//   - No clip is in effect, and the save stack is at its base. Clips and depth
//     are tracked through `save`, `restore`, `clip` and `reset`, and the tracking
//     is dropped whenever the backing store is resized, since a resize clears the
//     state this module would be remembering. The base of the stack is where a
//     frame's background fill sits, and it is the only place a clear buys
//     anything: a canvas keeps everything recorded before a `save` that is still
//     open.
//
// WHAT IS NOT COVERED. Two shapes of frame, and both pay what the canvas charges:
// one opened with an opaque background IMAGE rather than a fill, and one whose
// covering fill is issued under an open `save`. Neither is a defect this module
// could fix. The image is not a rectangle whose cover can be proved from the
// arguments; the save is a level of the stack the canvas keeps everything before,
// measured here at 23.7 s against 0.21 s for the same clear at the base, so a
// clear issued there would cost the pixels nothing and buy nothing either. The
// BROWSER implementation, `validation/none/raster-init.js`, carries no such depth
// guard, because Chromium truncates for a clear under an open save exactly as it
// does at the base: the same scene costs 0.26 s to drive and screenshot from
// either, against 27.4 s with no clear. The rule is one rule; where they differ is
// in what a clear is worth, and each implementation is written to its own.
//
// Neither shape bites the engines this case ships. `simple-2d` and
// `structured-2d` both open a frame by painting the declared background at the
// base of the stack, or by clearing when a build declares none, so an
// engine-backed frame is truncated whatever the build draws after it.
//
// Nothing here can make a build's pixels differ from what it drew.
//
// WHAT THE BUILD CAN SEE. Nothing. The clear is issued against the context
// underneath the harness's own recorder, so it appears in no draw-call list and
// in no captured replay, and it is bracketed in `save`/`restore` so the transform
// the build set is what its own fill runs under.

import { createCanvas } from "@napi-rs/canvas";
import type { DOMMatrix, SKRSContext2D } from "@napi-rs/canvas";

/**
 * The composite operators under which an opaque fill replaces what it covers.
 *
 * Every other operator blends the fill with what is already there, so what the
 * frames before it drew is still visible through it and still has to be drawn.
 */
const REPLACING = new Set(["source-over", "copy"]);

/**
 * Whether each fill style paints at full alpha, keyed by the style as the context
 * itself reports it.
 *
 * A style is measured once. The answer is a property of the string and of the
 * canvas implementation, so a suite that fills its stage in the same colour on
 * every frame measures it on the first one.
 */
const opaque = new Map<string, boolean>();

/** Whether a fill in `style` covers what is under it. */
function isOpaque(style: string): boolean {
  const known = opaque.get(style);
  if (known !== undefined) return known;
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, 1, 1);
  const measured = ctx.getImageData(0, 0, 1, 1).data[3] === 255;
  opaque.set(style, measured);
  return measured;
}

/** Whether every one of these is a number a rectangle can be built out of. */
function allFinite(values: readonly unknown[]): values is number[] {
  return values.every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
}

/**
 * A context that clears the backing store before a fill that would cover it.
 *
 * Wrap the real context in this BEFORE any recorder: the clear is issued against
 * the context handed in, so a recorder layered on top records the build's own
 * calls and nothing of this module's.
 */
export function clearBeforeCoveringFills(ctx: SKRSContext2D): SKRSContext2D {
  // One entry per level of the save stack, each saying whether a clip was applied
  // at that level. A clip applied at any live level is a clip in effect.
  let clipped = [false];
  let width = ctx.canvas.width;
  let height = ctx.canvas.height;

  const forgetState = (): void => {
    clipped = [false];
  };

  /** Whether the fill `args` describes covers the backing store under `m`. */
  const covers = (args: unknown[], m: DOMMatrix): boolean => {
    const rect = [args[0], args[1], args[2], args[3]];
    if (!allFinite(rect)) return false;
    const [x, y, w, h] = rect;
    // A rotation or a skew turns the rectangle into a quadrilateral, whose cover
    // this module does not reason about.
    if (m.b !== 0 || m.c !== 0) return false;
    if (![m.a, m.d, m.e, m.f].every(Number.isFinite)) return false;
    const xs = [m.a * x + m.e, m.a * (x + w) + m.e];
    const ys = [m.d * y + m.f, m.d * (y + h) + m.f];
    return (
      Math.min(...xs) <= 0 &&
      Math.min(...ys) <= 0 &&
      Math.max(...xs) >= width &&
      Math.max(...ys) >= height
    );
  };

  const clearFirst = (args: unknown[]): void => {
    // A resize clears the backing store, its clip and its save stack, so what was
    // tracked before one says nothing about the state now.
    if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
      width = ctx.canvas.width;
      height = ctx.canvas.height;
      forgetState();
    }
    // Only at the base of the save stack. A canvas keeps everything recorded
    // before a `save` that is still open, so a clear issued under one buys
    // nothing: measured here at 14.2 s against 0.14 s for the same clear issued
    // at the base. A frame's background fill is issued at the base.
    if (clipped.length > 1) return;
    if (clipped.includes(true)) return;
    if (ctx.globalAlpha !== 1) return;
    if (ctx.filter !== "none") return;
    if (!REPLACING.has(String(ctx.globalCompositeOperation))) return;
    const style = ctx.fillStyle;
    if (typeof style !== "string" || !isOpaque(style)) return;
    const m = ctx.getTransform();
    if (!covers(args, m)) return;
    // The transform is moved and put back rather than pushed and popped: a clear
    // bracketed in `save`/`restore` is one the canvas keeps everything before,
    // measured here at 14.2 s against 0.13 s for the same clear issued plainly.
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
    } finally {
      ctx.setTransform(m);
    }
  };

  const wrapped = new Map<string, (...args: unknown[]) => unknown>();

  return new Proxy(ctx, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      const method = String(property);
      const known = wrapped.get(method);
      if (known !== undefined) return known;
      const call = value as (...rest: unknown[]) => unknown;
      let fn: (...args: unknown[]) => unknown;
      switch (method) {
        case "save":
          fn = (...args: unknown[]): unknown => {
            clipped.push(false);
            return call.apply(object, args);
          };
          break;
        case "restore":
          fn = (...args: unknown[]): unknown => {
            if (clipped.length > 1) clipped.pop();
            return call.apply(object, args);
          };
          break;
        case "clip":
          fn = (...args: unknown[]): unknown => {
            clipped[clipped.length - 1] = true;
            return call.apply(object, args);
          };
          break;
        case "reset":
          fn = (...args: unknown[]): unknown => {
            forgetState();
            return call.apply(object, args);
          };
          break;
        case "fillRect":
          fn = (...args: unknown[]): unknown => {
            clearFirst(args);
            return call.apply(object, args);
          };
          break;
        default:
          fn = (...args: unknown[]): unknown => call.apply(object, args);
      }
      wrapped.set(method, fn);
      return fn;
    },
    set(object, property, value) {
      return Reflect.set(object, property, value, object);
    },
  });
}
