// Meltdown — combat/no-target-no-shot: an idle gun fires nothing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With no unit in range a tower reports firing false, targeting null, and
//   gains no heat over a second.

import { it } from "vitest";

it("An idle gun fires nothing", () => {
  throw new Error(
    "Meltdown: validation/combat/no-target-no-shot.test.ts is not implemented yet",
  );
});
