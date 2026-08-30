// Meltdown — movers/forge-caps-at-its-setpoint: the Forge never pushes past
// its setpoint.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   An emitter at 72 and one at 90 both gain nothing from a level-I Forge.

import { it } from "vitest";

it("The Forge never pushes past its setpoint", () => {
  throw new Error(
    "Meltdown: validation/movers/forge-caps-at-its-setpoint.test.ts is not implemented yet",
  );
});
