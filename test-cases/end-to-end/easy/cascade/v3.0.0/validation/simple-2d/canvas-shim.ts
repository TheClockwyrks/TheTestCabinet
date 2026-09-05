// Cascade — the two browser drawing surfaces, over a Node canvas. CASE-PROVIDED.
//
// The victory cascade's painted layer persists across frames, and the engine
// clears the canvas before every one of them, so the layer is a drawing surface
// of the build's own (specs/victory.md). A browser build makes one the only two
// ways a browser offers: `new OffscreenCanvas(w, h)`, or a detached
// `document.createElement("canvas")`.
//
// These suites run under vitest's `node` environment, where neither exists, so a
// build that reached for either would throw inside the validator and fail every
// point that draws. Both are therefore stood up here over `@napi-rs/canvas`,
// which is the same implementation the harness draws the frame itself on.
//
// `harness.ts` imports this module before it imports anything of the build's, so
// the surfaces are in place by the time the build's own module graph is
// evaluated. Nothing asserts that they are, so a shim that stopped working
// would show up as a wave of build failures rather than as one loud fault of
// its own.
//
// Each is installed ONLY IF ABSENT, so a host that offers the real thing keeps
// it and nothing here can displace a browser's own.

import { createCanvas } from "@napi-rs/canvas";

/** The stand-in for the browser's `OffscreenCanvas`, at the size asked for. */
class NodeOffscreenCanvas {
  constructor(width: number, height: number) {
    return createCanvas(width, height) as unknown as NodeOffscreenCanvas;
  }
}

/**
 * The stand-in for `document`, carrying the one method a build makes a drawing
 * surface with.
 *
 * A `1 x 1` canvas, because the caller sets `width` and `height` itself, which
 * is what a browser's own detached canvas requires of it.
 */
const documentShim = {
  createElement(tag: string): unknown {
    if (tag !== "canvas") {
      throw new Error(`Cascade: the validator host offers no <${tag}> element`);
    }
    return createCanvas(1, 1);
  },
};

if (!("OffscreenCanvas" in globalThis)) {
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: NodeOffscreenCanvas,
    configurable: true,
  });
}

if (!("document" in globalThis)) {
  Object.defineProperty(globalThis, "document", {
    value: documentShim,
    configurable: true,
  });
}
