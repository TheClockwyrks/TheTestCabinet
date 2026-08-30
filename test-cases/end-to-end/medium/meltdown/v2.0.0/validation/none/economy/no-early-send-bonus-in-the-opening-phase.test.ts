// Meltdown — economy/no-early-send-bonus-in-the-opening-phase: starting Wave 1
// pays no bonus.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Sending from the untimed opening phase adds nothing.

import { it } from "vitest";

it("Starting Wave 1 pays no bonus", () => {
  throw new Error(
    "Meltdown: validation/economy/no-early-send-bonus-in-the-opening-phase.test.ts is not implemented yet",
  );
});
