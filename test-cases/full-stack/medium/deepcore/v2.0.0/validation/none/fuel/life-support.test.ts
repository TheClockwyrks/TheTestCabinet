// Deepcore — fuel.life-support. STUB: NOT YET AUTHORED.
//
// Being underground burns life support
//
// Below the surface ground line the miner burns LIFE_SUPPORT_BURN (0.4) fuel
// per second whatever it is doing, so a long dig costs fuel even standing
// still.
//
// Automated validation: stand the miner idle on a posed floor below the
// surface with nothing held, advance a fixed span and hold the fuel spent
// against LIFE_SUPPORT_BURN times the span.
//
// `test-case.toml` declares this suite as `fuel/life-support.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (underground (replay)) around the drive.

import { test } from "vitest";

test("Being underground burns life support", () => {
  throw new Error(
    "Deepcore validator `fuel/life-support` is declared in test-case.toml but has not been authored yet.",
  );
});
