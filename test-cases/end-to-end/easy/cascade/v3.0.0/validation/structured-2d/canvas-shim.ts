// Cascade — the two browser drawing surfaces a headless host has not got.
// CASE-PROVIDED.
//
// The victory cascade paints a PERMANENT trail: the engine clears the canvas
// before every frame and offers no opt-out, so a mark that has to outlive the
// frame it was made in cannot be drawn onto the frame's own context
// (specs/victory.md). A build therefore keeps a stage-sized offscreen drawing
// surface of its own and blits it, and a browser gives it two ways of making
// one — `new OffscreenCanvas(w, h)`, and a detached `<canvas>` element from
// `document.createElement`.
//
// These suites run under vitest's `node` environment, where the host has
// NEITHER. That is not a fault in the build: the engine takes every measurement
// from the `SurfaceMetrics` the harness supplies and needs no DOM, so `node` is
// the right environment for a validator, and it is the environment Carom's,
// Refract's and Wireworm's engine suites all run in. But a build that reached
// for either constructor would throw inside its own draw, and the throw would
// fail every point that renders a frame — grading a perfectly conformant build
// against the absence of a browser.
//
// So both are stood up here, backed by `@napi-rs/canvas`, which is the same
// implementation the harness draws the stage into. `harness.ts` imports this
// module FIRST, before anything of the build's, so the shim is in place before
// any module of the build has been evaluated and long before its state is
// built. Nothing asserts that it is there, so a shim that stopped working would
// fail as a wave of build failures nobody can read rather than as one loud fault
// of its own.
//
// Installed ONLY where the host has none, so this never displaces a real
// browser: a suite that one day runs under a DOM environment gets the DOM's own
// implementations, unchanged.
//
// The specification says nothing about how a build makes its layer — that would
// be coaching — and a build that makes one no other way is entitled to find the
// host without one and carry on: `specs/victory.md` counts the stamps
// (`trailStamps`) whether or not anything was painted, so the two items that
// read painted PIXELS are the only ones such a build could miss.

import { createCanvas } from "@napi-rs/canvas";

if (!("OffscreenCanvas" in globalThis)) {
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: class {
      constructor(width: number, height: number) {
        return createCanvas(width, height) as unknown as object;
      }
    },
    configurable: true,
  });
}

if (!("document" in globalThis)) {
  Object.defineProperty(globalThis, "document", {
    value: {
      createElement(tag: string): unknown {
        if (tag !== "canvas") throw new Error(`no element ${tag}`);
        return createCanvas(1, 1);
      },
    },
    configurable: true,
  });
}
