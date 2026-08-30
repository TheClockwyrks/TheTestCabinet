// Meltdown — audio/no-autoplay: nothing plays before the first interaction.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A freshly loaded build emits nothing until the first input reaches it.

import { it } from "vitest";

it("Nothing plays before the first interaction", () => {
  throw new Error(
    "Meltdown: validation/audio/no-autoplay.test.ts is not implemented yet",
  );
});
