import { defineConfig } from "vitest/config";

// Most of the suite drives a real canvas element, dispatches key and pointer
// events at a document, and reads back a 2D context, so the whole suite runs under
// jsdom rather than only the parts that obviously touch the document. The engine
// itself takes every measurement through a `SurfaceMetrics` and so runs with no
// document at all; jsdom here is the cheapest way to supply the element and the
// event target the tests assert against, not a requirement of the engine.
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
