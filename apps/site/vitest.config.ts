import { defineConfig } from "vitest/config";

/**
 * The suite of the build-time plugins, which run in Node beside the Vite config,
 * and of the reader of the static files they write.
 *
 * It is a config of its own so that the tests do not load `vite.config.ts`,
 * whose plugins would read the environment and the repository's `runs/`
 * directory. The gallery itself has no suite here: it is the shared UI
 * library's application, tested in `packages/ui`.
 */
export default defineConfig({
  test: {
    include: ["*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
