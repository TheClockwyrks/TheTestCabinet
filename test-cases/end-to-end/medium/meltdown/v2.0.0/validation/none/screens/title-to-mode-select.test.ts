// Meltdown — screens/title-to-mode-select: pLAY opens mode select.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Confirming PLAY moves the screen to modeselect rather than starting a
//   game.

import { it } from "vitest";

it("PLAY opens mode select", () => {
  throw new Error(
    "Meltdown: validation/screens/title-to-mode-select.test.ts is not implemented yet",
  );
});
