// Deepcore — cargo.full-bay-leaves-ore-behind. STUB: NOT YET AUTHORED.
//
// A full bay leaves ore behind and never hard-locks
//
// Drilling an ore cell with the bay full by slots still clears the cell to
// open tunnel and simply leaves the ore behind, so a full bay never traps the
// miner behind an undrillable cell.
//
// Automated validation: fill the bay to its cap, cut a posed ore cell through
// and read the cell as tunnel with the cargo count unchanged.
//
// `test-case.toml` declares this suite as `cargo/full-bay-leaves-ore-behind.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (full (replay)) around the drive.

import { test } from "vitest";

test("A full bay leaves ore behind and never hard-locks", () => {
  throw new Error(
    "Deepcore validator `cargo/full-bay-leaves-ore-behind` is declared in test-case.toml but has not been authored yet.",
  );
});
