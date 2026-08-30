// Meltdown — combat/rime-slow-degrades-with-heat: the slow fades as the Rime
// heats.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   At heat 50 the slow is 0.275, and the reported slowFactor follows slowCeil
//   * (1 - heat / 100) at five heats.

import { it } from "vitest";

it("The slow fades as the Rime heats", () => {
  throw new Error(
    "Meltdown: validation/combat/rime-slow-degrades-with-heat.test.ts is not implemented yet",
  );
});
