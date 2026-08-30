// Meltdown — trip/tripped-stops-firing: a tripped tower is offline.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Over the whole cooldown a tripped tower reports firing false, deals no
//   damage to a unit in range and takes no kill.

import { it } from "vitest";

it("A tripped tower is offline", () => {
  throw new Error(
    "Meltdown: validation/trip/tripped-stops-firing.test.ts is not implemented yet",
  );
});
