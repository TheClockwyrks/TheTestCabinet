// The vitest project a case's validators run as.
//
// Everything but the dials is fixed, because everything but the dials is what
// makes a staged validator project one shape the runner can drive: what it
// collects, what it loads first, and its refusal to pass a run that collected
// nothing. A case that could vary those could quietly stop the runner from
// finding its checks at all.

import { expect, it } from "vitest";
import { defineValidationConfig } from "../src/vitest-config";

it("fixes what the runner has to be able to rely on", () => {
  const config = defineValidationConfig({ root: "/build" });

  expect(config.root).toBe("/build");
  expect(config.test).toMatchObject({
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    globalSetup: ["validation/globalSetup.ts"],
    setupFiles: ["validation/setup.ts"],
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
    minWorkers: 1,
  });
});

it("leaves the per-case dials to the case", () => {
  // What a check costs is the case's: one whose pointer operations take effect
  // the moment they are called spends a few hundred crossings on its longest
  // scenario, while one whose scenario walks a level to its clear spends thousands
  // of real simulated ticks.
  const brisk = defineValidationConfig({ root: "/build", testTimeout: 60_000 });
  expect(brisk.test?.testTimeout).toBe(60_000);
  expect(brisk.test?.hookTimeout).toBe(60_000);
  expect(brisk.test?.maxWorkers).toBe(4);

  const patient = defineValidationConfig({
    root: "/build",
    testTimeout: 120_000,
    hookTimeout: 90_000,
    maxWorkers: 2,
  });
  expect(patient.test?.testTimeout).toBe(120_000);
  expect(patient.test?.hookTimeout).toBe(90_000);
  expect(patient.test?.maxWorkers).toBe(2);
});
