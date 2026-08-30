// Meltdown — screens/mode-descriptions-before-choosing: a mode's description
// is readable before it is chosen.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Moving the highlight across the five modes draws a different body of text
//   for each, without starting anything.

import { it } from "vitest";

it("A mode's description is readable before it is chosen", () => {
  throw new Error(
    "Meltdown: validation/screens/mode-descriptions-before-choosing.test.ts is not implemented yet",
  );
});
