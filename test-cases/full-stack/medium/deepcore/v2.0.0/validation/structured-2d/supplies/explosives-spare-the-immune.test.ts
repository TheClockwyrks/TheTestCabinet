// Deepcore — supplies.explosives-spare-the-immune. STUB: NOT YET AUTHORED.
//
// Bedrock, material nodes and the Core survive a blast
//
// Bedrock, material nodes and the Core are immune to explosives and are never
// cleared, so a blast can never destroy the only source of a rocket component.
//
// Automated validation: pose a material node, the Core and bedrock inside a
// Plastic Explosives block and read all three unchanged after the blast.
//
// `test-case.toml` declares this suite as `supplies/explosives-spare-the-immune.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (immune (replay)) around the drive.

import { test } from "vitest";

test("Bedrock, material nodes and the Core survive a blast", () => {
  throw new Error(
    "Deepcore validator `supplies/explosives-spare-the-immune` is declared in test-case.toml but has not been authored yet.",
  );
});
