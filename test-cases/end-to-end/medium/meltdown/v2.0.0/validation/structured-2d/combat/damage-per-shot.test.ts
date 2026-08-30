// Meltdown — combat/damage-per-shot: a shot removes exactly its damage.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   An Arc's shot drops a unit's hp by exactly baseDamage(level) *
//   heatMultiplier(heat, 80) at three heats.

import { it } from "vitest";

it("A shot removes exactly its damage", () => {
  throw new Error(
    "Meltdown: validation/combat/damage-per-shot.test.ts is not implemented yet",
  );
});
