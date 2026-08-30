// Meltdown — building/preview-follows-the-pointer: the preview follows the
// pointer.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A pointer move over the floor centres the held footprint on the pointer,
//   at all three footprint sizes.

import { it } from "vitest";

it("The preview follows the pointer", () => {
  throw new Error(
    "Meltdown: validation/building/preview-follows-the-pointer.test.ts is not implemented yet",
  );
});
