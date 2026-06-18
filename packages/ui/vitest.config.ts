import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Component tests for the shared gallery app run under jsdom with the React
// plugin (so JSX/Fast-Refresh-free transforms work). SCSS modules are stubbed —
// see `src/test/setup.ts` — since these tests assert behavior, not styling.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
