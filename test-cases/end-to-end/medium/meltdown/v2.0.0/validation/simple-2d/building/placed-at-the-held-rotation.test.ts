// Meltdown — building/placed-at-the-held-rotation: a tower is built at the
// rotation it was held at.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A preview rotated to 2 and placed produces a tower reporting rotation 2
//   and the matching world faces.

import { it } from "vitest";

it("A tower is built at the rotation it was held at", () => {
  throw new Error(
    "Meltdown: validation/building/placed-at-the-held-rotation.test.ts is not implemented yet",
  );
});
