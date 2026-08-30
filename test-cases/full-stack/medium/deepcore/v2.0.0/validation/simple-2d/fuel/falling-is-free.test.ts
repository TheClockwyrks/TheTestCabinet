// Deepcore — fuel.falling-is-free. STUB: NOT YET AUTHORED.
//
// Falling costs no thrust or drill fuel
//
// An unsupported miner falls under gravity and pays no thrust or drill fuel
// for it, only the underground life-support trickle, so descending is cheap
// and only the climb burns.
//
// Automated validation: drop the miner down a long cleared shaft with nothing
// held and hold the fuel spent against the life-support drain alone.
//
// `test-case.toml` declares this suite as `fuel/falling-is-free.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (plunge (replay)) around the drive.

import { test } from "vitest";

test("Falling costs no thrust or drill fuel", () => {
  throw new Error(
    "Deepcore validator `fuel/falling-is-free` is declared in test-case.toml but has not been authored yet.",
  );
});
