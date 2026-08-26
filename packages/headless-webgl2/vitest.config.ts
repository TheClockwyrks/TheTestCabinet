import { defineConfig } from "vitest/config";

// The whole point of this package is that it needs no browser and no DOM: the
// canvas is a plain object and the context is implemented in process, so the
// suite runs under plain Node. Nothing in here should ever need jsdom — a test
// that reaches for a document is a test of the wrong package.
export default defineConfig({
  test: {
    environment: "node",
  },
});
