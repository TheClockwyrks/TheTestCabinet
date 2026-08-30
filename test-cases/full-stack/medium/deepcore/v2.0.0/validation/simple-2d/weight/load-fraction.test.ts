// Deepcore — weight.load-fraction. STUB: NOT YET AUTHORED.
//
// The load is the weight of what is held
//
// cargo.loadKg is the sum of the weights of the units held, at the per-ore
// weights in specs/mining.md, and liftLimitKg is the jetpack tier lift limit,
// so the load fraction the rest of the model uses is loadKg over liftLimitKg.
//
// Automated validation: pose a known mix of ore and gemstone counts and hold
// loadKg against the sum of their stated weights and liftLimitKg against the
// tier.
//
// `test-case.toml` declares this suite as `weight/load-fraction.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (load (image)) around the drive.

import { test } from "vitest";

test("The load is the weight of what is held", () => {
  throw new Error(
    "Deepcore validator `weight/load-fraction` is declared in test-case.toml but has not been authored yet.",
  );
});
