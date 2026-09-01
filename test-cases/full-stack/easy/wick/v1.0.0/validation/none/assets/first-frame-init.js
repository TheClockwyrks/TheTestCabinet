/*
 * Wick — the injected first-frame probe. CASE-PROVIDED, for one review point.
 *
 * WHAT THE POINT NEEDS. specs/assets.md: "Every image is decoded and every sound
 * is bound to its cue before the first frame draws." That is a statement about an
 * ORDER — the last load finishing before the first draw starting — and no reading
 * taken after the page has settled can recover it, because by then both have
 * happened. So the order is recorded as it happens, by a script injected before a
 * line of the build's own runs, and the point reads the record.
 *
 * WHAT IS WATCHED.
 *
 *   1. THE FIRST DRAW. Every 2D drawing method the shared recorder counts as one
 *      is wrapped on `CanvasRenderingContext2D.prototype`, and the first call to
 *      any of them is the moment the first frame began to draw. `clearRect` is
 *      deliberately not among them: a build that clears its canvas while it is
 *      still loading has not drawn a frame.
 *   2. EVERY IMAGE. `HTMLImageElement`'s `src` setter is wrapped, so an image is
 *      counted from the moment a URL is put on it whether the build made it with
 *      `new Image()` or `document.createElement("img")`, and its `load` or
 *      `error` settles it. `createImageBitmap` is wrapped for a build that
 *      decodes that way instead.
 *   3. EVERY CUE. A cue is bound when its file has been decoded through the Web
 *      Audio API, which this case's audio probe already logs, or when a media
 *      element has been pointed at it, which is the other road a browser takes a
 *      produced `.wav` along. Both are read here, and a cue bound either way
 *      counts as bound.
 *
 * WHAT IS ASSERTABLE. How many images were still in flight when the first frame
 * began to draw, how many settled after it, and which cues were bound by then.
 * Nothing about what the frame drew, which is every other presentation point's
 * business.
 *
 * Exposed as `window.__wickFirstFrame`. Nothing here is ever seeded into a run.
 */
(() => {
  /** The fifteen cue names specs/ui.md fixes, longest first for the match. */
  const CUE_NAMES = [
    "hit",
    "kill",
    "gem",
    "hurt",
    "level-up",
    "choose",
    "chest",
    "evolve",
    "pickup",
    "fallen",
    "dawn",
    "menu-move",
    "menu-confirm",
    "music",
    "hum",
  ].sort((a, b) => b.length - a.length);

  /** The drawing methods the shared recorder counts as a drawing operation. */
  const DRAW_METHODS = [
    "arc",
    "ellipse",
    "rect",
    "roundRect",
    "fillRect",
    "strokeRect",
    "moveTo",
    "lineTo",
    "quadraticCurveTo",
    "bezierCurveTo",
    "fill",
    "stroke",
    "fillText",
    "strokeText",
    "drawImage",
    "putImageData",
  ];

  const state = {
    /** Whether any drawing method has been called yet. */
    drawn: false,
    /** Images a URL was put on. */
    imagesStarted: 0,
    /** Images whose load or error settled. */
    imagesSettled: 0,
    /** Images that settled only after the first drawing call. */
    imagesSettledAfterDraw: 0,
    /** Images still in flight when the first drawing call ran. */
    imagesInFlightAtDraw: null,
    /** Cues bound to a file, in the order they were bound. */
    boundCues: [],
    /** The cues bound when the first drawing call ran. */
    boundAtDraw: null,
  };

  /** The basename of a URL, less its query, fragment, and extension. */
  const basename = (url) => {
    let path = String(url).split("#")[0].split("?")[0];
    const slash = path.lastIndexOf("/");
    if (slash >= 0) path = path.slice(slash + 1);
    const dot = path.lastIndexOf(".");
    if (dot > 0) path = path.slice(0, dot);
    return path;
  };

  /** The cue a URL stands for, allowing for a bundler's content hash. */
  const cueName = (url) => {
    if (typeof url !== "string" || url === "" || url.startsWith("data:")) {
      return null;
    }
    const name = basename(url);
    for (const cue of CUE_NAMES) {
      if (name === cue || name.startsWith(`${cue}-`)) return cue;
    }
    return null;
  };

  const bind = (url) => {
    const name = cueName(url);
    if (name !== null && !state.boundCues.includes(name)) {
      state.boundCues.push(name);
    }
  };

  const noteDraw = () => {
    if (state.drawn) return;
    state.drawn = true;
    state.imagesInFlightAtDraw = state.imagesStarted - state.imagesSettled;
    const audio = window.__wickAudio;
    const decoded =
      audio && typeof audio.decoded === "function" ? audio.decoded() : [];
    state.boundAtDraw = Array.from(new Set([...state.boundCues, ...decoded]));
  };

  const settle = () => {
    state.imagesSettled += 1;
    if (state.drawn) state.imagesSettledAfterDraw += 1;
  };

  window.__wickFirstFrame = {
    /** Everything recorded so far, as a plain object. */
    read: () => {
      const audio = window.__wickAudio;
      const decoded =
        audio && typeof audio.decoded === "function" ? audio.decoded() : [];
      return {
        drawn: state.drawn,
        imagesStarted: state.imagesStarted,
        imagesSettled: state.imagesSettled,
        imagesSettledAfterDraw: state.imagesSettledAfterDraw,
        imagesInFlightAtDraw: state.imagesInFlightAtDraw,
        boundAtDraw: state.boundAtDraw,
        boundNow: Array.from(new Set([...state.boundCues, ...decoded])),
      };
    },
  };

  /* ---- The first draw ------------------------------------------------------ */

  const context = window.CanvasRenderingContext2D?.prototype;
  if (context) {
    for (const method of DRAW_METHODS) {
      const original = context[method];
      if (typeof original !== "function") continue;
      context[method] = function (...args) {
        noteDraw();
        return original.apply(this, args);
      };
    }
  }

  /* ---- Every image --------------------------------------------------------- */

  const image = window.HTMLImageElement?.prototype;
  const src =
    image && Object.getOwnPropertyDescriptor(image, "src");
  if (src && typeof src.set === "function") {
    Object.defineProperty(image, "src", {
      ...src,
      set(value) {
        state.imagesStarted += 1;
        let settled = false;
        const once = () => {
          if (settled) return;
          settled = true;
          settle();
        };
        this.addEventListener("load", once);
        this.addEventListener("error", once);
        src.set.call(this, value);
        // An image already complete when the URL lands — a cached or inlined one
        // — fires nothing, so it is settled here instead.
        if (this.complete === true) once();
      },
    });
  }

  const createImageBitmap = window.createImageBitmap;
  if (typeof createImageBitmap === "function") {
    window.createImageBitmap = function (...args) {
      state.imagesStarted += 1;
      return createImageBitmap.apply(this, args).then(
        (bitmap) => {
          settle();
          return bitmap;
        },
        (error) => {
          settle();
          throw error;
        },
      );
    };
  }

  /* ---- Every cue ----------------------------------------------------------- */

  const media = window.HTMLMediaElement?.prototype;
  const mediaSrc = media && Object.getOwnPropertyDescriptor(media, "src");
  if (mediaSrc && typeof mediaSrc.set === "function") {
    Object.defineProperty(media, "src", {
      ...mediaSrc,
      set(value) {
        bind(value);
        mediaSrc.set.call(this, value);
      },
    });
  }
})();
