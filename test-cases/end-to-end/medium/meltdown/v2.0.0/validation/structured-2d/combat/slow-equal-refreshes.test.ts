// Meltdown — combat/slow-equal-refreshes: an equal slow refreshes the timer.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit carrying a 0.55 slow with half its time left, hit by another 0.55
//   slow, keeps slowFactor 0.55 and reports slowTimer back at SLOW_TIME.

import { it } from "vitest";

it("An equal slow refreshes the timer", () => {
  throw new Error(
    "Meltdown: validation/combat/slow-equal-refreshes.test.ts is not implemented yet",
  );
});
