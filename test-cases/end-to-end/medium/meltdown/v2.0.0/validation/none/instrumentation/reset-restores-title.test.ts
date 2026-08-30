// Meltdown — instrumentation/reset-restores-title: reset returns the game to
// its title values.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   After a run has been posed with a mode, money, lives, a score, towers and
//   units, reset() restores every declared field to the value the spec lists
//   and leaves muted untouched.

import { it } from "vitest";

it("reset returns the game to its title values", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/reset-restores-title.test.ts is not implemented yet",
  );
});
