import { defineConfig } from "vitest/config";

// The engine is plain TypeScript over DOM APIs — it fits a canvas to its element,
// listens for key and pointer events on `window`, and installs its host interface
// on `window`. None of that has a headless equivalent, so the whole suite runs
// under jsdom rather than only the parts that obviously touch the document.
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
