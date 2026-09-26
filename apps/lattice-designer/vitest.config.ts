import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The designer's tests cover two layers.
//
// The pure rules — parsing a committed scenario and projecting one back out,
// resizing the board, and the rules deciding when a field's typing reaches the
// design — are plain functions and need no DOM.
//
// The board-size contract cannot be tested that way, because the defect it pins is
// a wiring defect: the question is not "does `resizeBoard` lose components" but
// "can anything other than a deliberate Apply reach it". That is answered by driving
// the real component tree — typing into W, blurring it, clicking Apply, answering
// the dialog — so those need a DOM, and the React plugin for the JSX.
//
// `node` stays the default environment and the component test opts itself into
// jsdom with a `@vitest-environment` docblock, rather than the whole suite moving:
// under jsdom `import.meta.url` is an http URL, and the scenario round-trip test
// resolves the case's committed `cases/*.json` off a file one.
//
// `@lattice` and `@numeric` are aliased exactly as `vite.config.ts` and
// `tsconfig.json` alias them. The component tests stub `../assets` and
// `../useSimulation`, so the wasm engine behind `@lattice` is never loaded here.
const lattice = new URL(
  "../../packages/ui/src/app/pages/runs/lattice",
  import.meta.url,
).pathname;

const numeric = new URL(
  "../../packages/ui/src/app/components/numberFieldRules.ts",
  import.meta.url,
).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@lattice": lattice, "@numeric": numeric },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
