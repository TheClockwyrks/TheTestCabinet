// Deepcore — supplies.explosives-clear-stone. STUB: NOT YET AUTHORED.
//
// Explosives are the only way through unbreakable stone
//
// Unbreakable stone inside an explosives block clears to open tunnel, which is
// the only way past a boulder no drill can break.
//
// Automated validation: pose a stone cell beside the miner, use Dynamite and
// read the stone cell as tunnel.
//
// `test-case.toml` declares this suite as `supplies/explosives-clear-stone.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (boulder (replay)) around the drive.

import { test } from "vitest";

test("Explosives are the only way through unbreakable stone", () => {
  throw new Error(
    "Deepcore validator `supplies/explosives-clear-stone` is declared in test-case.toml but has not been authored yet.",
  );
});
