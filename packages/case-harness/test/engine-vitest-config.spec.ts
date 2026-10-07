// The vitest project an ENGINE validator project runs as.
//
// Imported by its own specifier, exactly as a case's `vitest.config.ts` does and
// for the reason the barrel does not re-export it.

import { expect, it } from "vitest";
import { defineEngineValidationConfig } from "../src/engine/vitest-config";
import { defineValidationConfig } from "../src/vitest-config";

const ROOT = "/workspace";

it("fixes everything that makes a staged project one shape the runner drives", () => {
  const config = defineEngineValidationConfig({ root: ROOT });
  expect(config.root).toBe(ROOT);
  expect(config.test?.name).toBe("validation");
  expect(config.test?.include).toEqual(["validation/**/*.test.ts"]);
  expect(config.test?.environment).toBe("node");
  // A missing validator is a broken suite, not a passing one.
  expect(config.test?.passWithNoTests).toBe(false);
  expect(config.test?.coverage).toEqual({ enabled: false });
});

it("names NO scaffolding, because an engine project stands nothing up", () => {
  const engine = defineEngineValidationConfig({ root: ROOT });
  const engineless = defineValidationConfig({ root: ROOT });
  // The engineless project serves a site and launches a browser before any suite
  // runs, and gives each worker's pages back afterwards. An engine project
  // constructs its engine in process and has neither.
  expect(engine.test?.globalSetup).toBeUndefined();
  expect(engine.test?.setupFiles).toBeUndefined();
  expect(engineless.test?.globalSetup).toEqual(["validation/globalSetup.ts"]);
});

it("sets both allowances, so vitest's ten-second hook default cannot decide a point", () => {
  const config = defineEngineValidationConfig({ root: ROOT });
  expect(config.test?.testTimeout).toBe(300_000);
  expect(config.test?.hookTimeout).toBe(120_000);
});

it("takes the ceilings a case genuinely disagrees on", () => {
  const config = defineEngineValidationConfig({
    root: ROOT,
    testTimeout: 600_000,
    hookTimeout: 60_000,
  });
  expect(config.test?.testTimeout).toBe(600_000);
  expect(config.test?.hookTimeout).toBe(60_000);
});

it("leaves the worker count to the pool unless a case names one", () => {
  // An engine project's worker is CPU-bound — it is running the build's
  // simulation — where an engineless project's is waiting on a browser, so the
  // two want opposite settings and this one wants the pool's own reading.
  expect(
    defineEngineValidationConfig({ root: ROOT }).test?.maxWorkers,
  ).toBeUndefined();
  expect(
    defineEngineValidationConfig({ root: ROOT, maxWorkers: 4 }).test
      ?.maxWorkers,
  ).toBe(4);
  expect(defineValidationConfig({ root: ROOT }).test?.maxWorkers).toBe(8);
});
