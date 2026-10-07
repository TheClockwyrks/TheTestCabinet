// The harness that runs the core's own tests in this directory. It is NOT
// copied into a build: a build runs these same `*.test.ts` files under its own
// `vitest.config.ts`, which already collects `src/**/*.test.ts`.
//
// The extension is `.mts` deliberately, so that copying the core into a build
// is exactly `cp core/*.ts <build>/src/core/` and picks up nothing but the
// modules and their tests.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "facet-core",
    include: ["*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["*.ts", "../constants.ts"],
      exclude: ["*.test.ts"],
    },
  },
});
