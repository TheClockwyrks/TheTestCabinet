/*
 * Spectra — the injected frame clear. CASE-PROVIDED.
 *
 * WHAT THIS IS FOR. A browser canvas rasterises nothing until someone asks for
 * pixels, and when they do it renders every operation the canvas has taken since
 * it last had reason to forget them. A `ctx.filter` chain is what makes that bill
 * enormous: the filter is applied over the whole backing store for every filtered
 * draw, so a build that tints a 28-unit sprite through
 * `grayscale(1) brightness(1.1) sepia(1) hue-rotate(290deg) saturate(7)` pays for
 * a 1280x720 filter pass per sprite, on every frame it has ever drawn, at the
 * screenshot inside `captureStill`. Measured in this project's own Chromium at
 * twenty filtered sprites a frame, that screenshot costs 254 ms after one frame
 * and 15.5 s after three hundred, and the frames themselves cost 54 s to drive.
 * A validator that captures one still therefore runs for minutes and is cut
 * short, and a build is marked down for colouring a sprite the way the platform
 * offers.
 *
 * A CANVAS THAT IS CLEARED FORGETS. `clearRect` over the whole backing store
 * discards every operation recorded before it, because nothing recorded before it
 * can be seen afterwards. `fillRect` over the whole backing store in an opaque
 * colour hides just as much and discards nothing, and that is exactly what a
 * frame opens with in a build that paints a stage background rather than clearing
 * to one.
 *
 * SO THE FRAME IS CLEARED FIRST. A fill this script can PROVE covers the whole
 * backing store opaquely is preceded by a full-canvas `clearRect`. The pixels are
 * what they were, because the fill that follows covers every pixel the clear
 * removed: the same three hundred frames screenshot to the SAME BYTES, in 269 ms
 * rather than 15.5 s, and drive in 45 ms rather than 54 s.
 *
 * WHAT COUNTS AS A PROOF. All of these, or the fill is left alone:
 *
 *   - The rectangle covers the backing store. Its corners are taken through the
 *     current transform, which must be axis-aligned for a rectangle to stay one.
 *   - The colour is opaque. It is MEASURED rather than parsed — the style is
 *     painted onto a probe pixel and its alpha read back — so a named colour, an
 *     `hsl`, an `oklch` and a hex with an alpha channel are all decided by what
 *     the canvas does with them. A gradient or a pattern is never a proof.
 *   - Nothing between the fill and the backing store can thin it: `globalAlpha`
 *     is 1, the filter is `none`, and the composite operator is one that replaces
 *     what it covers.
 *   - No clip is in effect. Clips are tracked through `save`, `restore`, `clip`
 *     and `reset`, and the tracking is dropped whenever the backing store is
 *     resized, since a resize clears the state this script would be remembering.
 *
 * WHAT IS NOT ON THAT LIST, AND WHY. The DEPTH of the save stack. The canvas
 * implementations the other two engines rasterise on keep everything recorded
 * before a `save` that is still open, so their `covered-frames.ts` refuses to
 * clear anywhere but the base of the stack: measured on `@napi-rs/canvas` at
 * 23.7 s against 0.21 s for the same clear at the base. Chromium does not behave
 * that way. A clear issued under an open `save` truncates exactly as one issued
 * at the base does, measured here at 0.26 s to drive and screenshot either way
 * against 27.4 s with no clear at all, so a depth guard here would refuse a clear
 * that works and leave a build that opens its frame inside a `save` paying the
 * whole bill. The rule the three implementations enforce is one rule; what a
 * clear is worth differs by platform, and each is written to the platform it
 * runs on. `raster-init.test.ts` holds this one to that difference, scene for
 * scene against the other two.
 *
 * A build that opens its frames some other way — an opaque background IMAGE, say
 * — is not covered by any of this and pays what the browser charges. Nothing here
 * can make a build's pixels differ from what it drew.
 *
 * WHERE IT SITS. On `CanvasRenderingContext2D.prototype`, under the recording
 * proxy `recorder-init.js` installs: that proxy applies a method to the real
 * context, so these wrappers run beneath it and the clear appears in no replay
 * recording and in no draw-call list. Every 2D context a page canvas hands out is
 * covered, including a scratch surface the build never attaches, and each is
 * judged on its own backing store.
 *
 * IT IS INJECTED FIRST, AHEAD OF THE RECORDER, so that the probe it measures a
 * colour on is a context of the page's own rather than a recording proxy. A
 * native canvas method refuses a proxy as its receiver, and the probe calls its
 * methods directly to keep out of its own way, so a probe taken through the
 * patched `getContext` would fail every measurement and quietly leave every frame
 * unclear.
 */

(() => {
  const proto = window.CanvasRenderingContext2D?.prototype;
  if (!proto || typeof proto.fillRect !== "function") return;

  /** The page's own `getContext`, taken before anything else replaces it. */
  const nativeGetContext = window.HTMLCanvasElement?.prototype?.getContext;

  const rawFillRect = proto.fillRect;
  const rawClearRect = proto.clearRect;
  const rawGetTransform = proto.getTransform;
  const rawSetTransform = proto.setTransform;
  const rawSave = proto.save;
  const rawRestore = proto.restore;
  const rawClip = proto.clip;
  const rawReset = typeof proto.reset === "function" ? proto.reset : null;

  /**
   * Whether each fill style paints at full alpha, keyed by the style as the
   * context itself reports it.
   *
   * Measured once per style. A suite that fills its stage in the same colour on
   * every frame measures it on the first one.
   */
  const opaque = new Map();
  let probe = null;
  let probing = false;

  const isOpaque = (style) => {
    const known = opaque.get(style);
    if (known !== undefined) return known;
    // The probe's own fill goes through the wrapper below, and the wrapper is
    // what asked the question: answering it while it is being answered would not
    // terminate.
    if (probing || typeof nativeGetContext !== "function") return false;
    probing = true;
    let measured = false;
    try {
      if (probe === null) {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        probe = nativeGetContext.call(canvas, "2d", {
          willReadFrequently: true,
        });
      }
      if (probe !== null) {
        rawClearRect.call(probe, 0, 0, 1, 1);
        probe.fillStyle = style;
        rawFillRect.call(probe, 0, 0, 1, 1);
        measured = probe.getImageData(0, 0, 1, 1).data[3] === 255;
      }
    } catch {
      measured = false;
    } finally {
      probing = false;
    }
    opaque.set(style, measured);
    return measured;
  };

  /** The operators under which an opaque fill replaces what it covers. */
  const REPLACING = new Set(["source-over", "copy"]);

  /**
   * Per context: how deep its save stack is, whether a clip was applied at each
   * level, and how big its backing store was when that was last true.
   */
  const state = new WeakMap();

  const stateOf = (ctx) => {
    let held = state.get(ctx);
    if (held === undefined) {
      held = {
        clipped: [false],
        width: ctx.canvas.width,
        height: ctx.canvas.height,
      };
      state.set(ctx, held);
    }
    if (ctx.canvas.width !== held.width || ctx.canvas.height !== held.height) {
      // A resize clears the backing store, its clip and its save stack, so what
      // was tracked before one says nothing about the state now.
      held.clipped = [false];
      held.width = ctx.canvas.width;
      held.height = ctx.canvas.height;
    }
    return held;
  };

  const finite = (value) => typeof value === "number" && Number.isFinite(value);

  /** Whether the fill `x, y, w, h` describes covers the whole backing store. */
  const covers = (ctx, m, width, height, x, y, w, h) => {
    if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return false;
    // A rotation or a skew turns the rectangle into a quadrilateral, whose cover
    // this script does not reason about.
    if (m.b !== 0 || m.c !== 0) return false;
    if (!finite(m.a) || !finite(m.d) || !finite(m.e) || !finite(m.f))
      return false;
    const xs = [m.a * x + m.e, m.a * (x + w) + m.e];
    const ys = [m.d * y + m.f, m.d * (y + h) + m.f];
    return (
      Math.min(xs[0], xs[1]) <= 0 &&
      Math.min(ys[0], ys[1]) <= 0 &&
      Math.max(xs[0], xs[1]) >= width &&
      Math.max(ys[0], ys[1]) >= height
    );
  };

  proto.save = function (...args) {
    stateOf(this).clipped.push(false);
    return rawSave.apply(this, args);
  };

  proto.restore = function (...args) {
    const held = stateOf(this);
    if (held.clipped.length > 1) held.clipped.pop();
    return rawRestore.apply(this, args);
  };

  proto.clip = function (...args) {
    const held = stateOf(this);
    held.clipped[held.clipped.length - 1] = true;
    return rawClip.apply(this, args);
  };

  if (rawReset !== null) {
    proto.reset = function (...args) {
      stateOf(this).clipped = [false];
      return rawReset.apply(this, args);
    };
  }

  proto.fillRect = function (x, y, w, h) {
    const held = stateOf(this);
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (
      !held.clipped.includes(true) &&
      this.globalAlpha === 1 &&
      this.filter === "none" &&
      REPLACING.has(String(this.globalCompositeOperation)) &&
      typeof this.fillStyle === "string" &&
      isOpaque(this.fillStyle)
    ) {
      const m = rawGetTransform.call(this);
      if (covers(this, m, width, height, x, y, w, h)) {
        try {
          rawSetTransform.call(this, 1, 0, 0, 1, 0, 0);
          rawClearRect.call(this, 0, 0, width, height);
        } finally {
          rawSetTransform.call(this, m);
        }
      }
    }
    return rawFillRect.call(this, x, y, w, h);
  };
})();
