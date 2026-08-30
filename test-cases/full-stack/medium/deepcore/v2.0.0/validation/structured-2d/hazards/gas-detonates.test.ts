// Deepcore — hazards.gas-detonates. STUB: NOT YET AUTHORED.
//
// A gas pocket detonates instead of clearing cleanly
//
// A gas pocket takes drill hits exactly as its band rock does, and when its
// health reaches 0 it detonates rather than clearing quietly. The cell becomes
// an open tunnel either way.
//
// Automated validation: pose a gas pocket under the miner in a cleared band,
// cut it through and read the hull dropped and the cell left as tunnel.
//
// `test-case.toml` declares this suite as `hazards/gas-detonates.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (blast (replay)) around the drive.

import { test } from "vitest";

test("A gas pocket detonates instead of clearing cleanly", () => {
  throw new Error(
    "Deepcore validator `hazards/gas-detonates` is declared in test-case.toml but has not been authored yet.",
  );
});
