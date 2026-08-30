// Meltdown — waves/game-over-at-zero-lives: zero lives ends the run.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Lives reaching 0 through leaks shows the game-over screen, mid-wave.

import { it } from "vitest";

it("Zero lives ends the run", () => {
  throw new Error(
    "Meltdown: validation/waves/game-over-at-zero-lives.test.ts is not implemented yet",
  );
});
