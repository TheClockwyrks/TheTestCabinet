// Meltdown — audio/place-cue: placing a tower plays its cue.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A pointer press and release on a valid footprint, armed through the
//   reported shop rect, emits the place cue on the frame the tower lands; the
//   same press on an invalid footprint emits nothing.

import { it } from "vitest";

it("Placing a tower plays its cue", () => {
  throw new Error(
    "Meltdown: validation/audio/place-cue.test.ts is not implemented yet",
  );
});
