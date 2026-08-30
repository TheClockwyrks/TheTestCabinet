// Meltdown — modes/sudden-death-ends-on-one-leak: one leak ends a Sudden Death
// run.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A single Mote reaching its exhaust in Sudden Death takes lives to 0 and
//   shows the game-over screen.

import { it } from "vitest";

it("One leak ends a Sudden Death run", () => {
  throw new Error(
    "Meltdown: validation/modes/sudden-death-ends-on-one-leak.test.ts is not implemented yet",
  );
});
