// Meltdown — heat/curve-is-quadratic: the climb is quadratic.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   At half the redline the multiplier is 0.35 + 3.15 * 0.25 (1.1375), which
//   no linear ramp reaches.

import { it } from "vitest";

it("The climb is quadratic", () => {
  throw new Error(
    "Meltdown: validation/heat/curve-is-quadratic.test.ts is not implemented yet",
  );
});
