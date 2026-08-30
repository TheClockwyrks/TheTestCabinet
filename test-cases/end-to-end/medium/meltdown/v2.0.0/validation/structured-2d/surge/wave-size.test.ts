// Meltdown — surge/wave-size: a wave releases its stated count.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Wave w releases ceil(base * (1 + 0.22 * (w - 1))) units of its type, and a
//   milestone wave releases exactly one Core.

import { it } from "vitest";

it("A wave releases its stated count", () => {
  throw new Error(
    "Meltdown: validation/surge/wave-size.test.ts is not implemented yet",
  );
});
