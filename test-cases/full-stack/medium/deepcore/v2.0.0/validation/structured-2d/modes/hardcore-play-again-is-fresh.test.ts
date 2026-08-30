// Deepcore — modes.hardcore-play-again-is-fresh. STUB: NOT YET AUTHORED.
//
// Hardcore PLAY AGAIN starts a completely fresh expedition
//
// PLAY AGAIN after a Hardcore death starts a fresh Hardcore expedition at the
// same world size, with tier 1 on every track, 0 Credits, nothing held and no
// component installed.
//
// Automated validation: die in Hardcore having earned Credits and tiers,
// choose PLAY AGAIN and read every holding back at its starting value with the
// size unchanged.
//
// `test-case.toml` declares this suite as `modes/hardcore-play-again-is-fresh.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (restart (image)) around the drive.

import { test } from "vitest";

test("Hardcore PLAY AGAIN starts a completely fresh expedition", () => {
  throw new Error(
    "Deepcore validator `modes/hardcore-play-again-is-fresh` is declared in test-case.toml but has not been authored yet.",
  );
});
