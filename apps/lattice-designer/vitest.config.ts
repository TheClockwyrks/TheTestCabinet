import { defineConfig } from "vitest/config";

// The designer's unit tests cover the pure model — parsing a committed scenario and
// projecting one back out. No DOM is involved, so they run in plain node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
