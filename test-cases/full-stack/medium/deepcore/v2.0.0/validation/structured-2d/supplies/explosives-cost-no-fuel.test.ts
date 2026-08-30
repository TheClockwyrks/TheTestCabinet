// Deepcore — supplies.explosives-cost-no-fuel. STUB: NOT YET AUTHORED.
//
// A blast is instant and free of fuel
//
// The clear is instant and costs no fuel, so an explosive is paid for in
// Credits alone.
//
// Automated validation: pose a known tank, use Dynamite and read the fuel
// unchanged and the block cleared in the same frame.
//
// `test-case.toml` declares this suite as `supplies/explosives-cost-no-fuel.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (free (replay)) around the drive.

import { test } from "vitest";

test("A blast is instant and free of fuel", () => {
  throw new Error(
    "Deepcore validator `supplies/explosives-cost-no-fuel` is declared in test-case.toml but has not been authored yet.",
  );
});
