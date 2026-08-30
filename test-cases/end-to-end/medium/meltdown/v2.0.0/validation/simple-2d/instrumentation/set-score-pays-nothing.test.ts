// Meltdown — instrumentation/set-score-pays-nothing: posing the score pays
// nothing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   setScore across every scoring boundary leaves money, lives and the wave
//   exactly as they were: the awards belong to the scoring path, and a pose is
//   a precondition.

import { it } from "vitest";

it("Posing the score pays nothing", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/set-score-pays-nothing.test.ts is not implemented yet",
  );
});
