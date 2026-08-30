// Meltdown — controls/confirm-key: enter confirms the highlighted row.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Enter on the title screen with menuIndex 0 opens mode select. A build
//   whose confirm does nothing can never reach a run, which is why the cap is
//   broken and every functional domain is named.

import { it } from "vitest";

it("Enter confirms the highlighted row", () => {
  throw new Error(
    "Meltdown: validation/controls/confirm-key.test.ts is not implemented yet",
  );
});
