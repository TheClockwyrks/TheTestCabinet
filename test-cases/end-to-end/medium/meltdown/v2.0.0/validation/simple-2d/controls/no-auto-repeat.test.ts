// Meltdown — controls/no-auto-repeat: a held key fires once.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Holding each one-shot key for a second of game time fires its action
//   exactly once.

import { it } from "vitest";

it("A held key fires once", () => {
  throw new Error(
    "Meltdown: validation/controls/no-auto-repeat.test.ts is not implemented yet",
  );
});
