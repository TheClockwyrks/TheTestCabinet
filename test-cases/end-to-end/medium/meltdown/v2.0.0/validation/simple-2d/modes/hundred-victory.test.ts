// Meltdown — modes/hundred-victory: clearing all hundred wins.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Posed with wavePending 0 and one live unit and at least one life, that
//   last unit going shows the victory screen. It is posed rather than released
//   so it does not depend on the spawner modes.hundred-releases-one-hundred
//   already decides.

import { it } from "vitest";

it("Clearing all hundred wins", () => {
  throw new Error(
    "Meltdown: validation/modes/hundred-victory.test.ts is not implemented yet",
  );
});
