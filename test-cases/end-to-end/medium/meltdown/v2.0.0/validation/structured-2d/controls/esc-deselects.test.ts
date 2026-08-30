// Meltdown — controls/esc-deselects: escape deselects before it pauses.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Escape with a tower selected and nothing armed clears selected and leaves
//   the screen playing.

import { it } from "vitest";

it("Escape deselects before it pauses", () => {
  throw new Error(
    "Meltdown: validation/controls/esc-deselects.test.ts is not implemented yet",
  );
});
