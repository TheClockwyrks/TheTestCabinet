import { defineConfig } from "vitest/config";

// The suite drives a real `<canvas>` element, dispatches key and pointer events at
// a document, reads back a 2D context, and constructs a real `THREE.WebGLRenderer`
// over the stubbed WebGL2 context in `src/testing/gl.ts`, so the whole suite runs
// under jsdom rather than only the parts that obviously touch the document. The
// engine itself takes every measurement through a `SurfaceMetrics` and so runs with
// no document at all; jsdom here is the cheapest way to supply the element, the
// event target, and the canvas the tests assert against, not a requirement of the
// engine.
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
