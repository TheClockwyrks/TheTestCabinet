// Deepcore — supplies.explosives-detonate-gas. STUB: NOT YET AUTHORED.
//
// A gas pocket in a blast detonates
//
// A gas pocket inside an explosives block detonates exactly as a drilled one
// does, at its depth damage, and the miner stands at the centre of the block,
// so a hidden pocket can hurt or kill it.
//
// Automated validation: pose a gas pocket inside a Dynamite block and hold the
// hull lost against the gas damage formula for that depth.
//
// `test-case.toml` declares this suite as `supplies/explosives-detonate-gas.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (chain (replay)) around the drive.

import { test } from "vitest";

test("A gas pocket in a blast detonates", () => {
  throw new Error(
    "Deepcore validator `supplies/explosives-detonate-gas` is declared in test-case.toml but has not been authored yet.",
  );
});
