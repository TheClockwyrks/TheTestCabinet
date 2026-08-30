// Meltdown — combat/rime-deals-its-damage: a Rime's shot removes damage like
// any other emitter's.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A Rime's shot drops its target's hp by exactly 4 * heatMultiplier(heat,
//   100) at three heats, so a Rime that only slows fails.

import { it } from "vitest";

it("A Rime's shot removes damage like any other emitter's", () => {
  throw new Error(
    "Meltdown: validation/combat/rime-deals-its-damage.test.ts is not implemented yet",
  );
});
