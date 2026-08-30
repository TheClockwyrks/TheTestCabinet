// Meltdown — hud/targeting-read: every tower's targeting reads on the panel.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Each emitter but the Flak reads as hitting ground and air, the Flak reads
//   air-only, and both movers read as never firing, on both the hover panel
//   and the inspector.

import { it } from "vitest";

it("Every tower's targeting reads on the panel", () => {
  throw new Error(
    "Meltdown: validation/hud/targeting-read.test.ts is not implemented yet",
  );
});
