// Meltdown — surge/hp-scales-with-the-wave: hP grows with the wave number.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit added on wave w reports maxHp of baseHp * (1 + 0.62 * (w - 1)),
//   checked at waves 1, 10 and 20.

import { it } from "vitest";

it("HP grows with the wave number", () => {
  throw new Error(
    "Meltdown: validation/surge/hp-scales-with-the-wave.test.ts is not implemented yet",
  );
});
