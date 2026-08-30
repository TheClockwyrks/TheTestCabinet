// Meltdown — waves/a-fatal-leak-on-the-final-wave-loses: a fatal leak on the
// last wave is a loss, not a win.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   The final wave's last unit leaking and taking lives to 0 clears the wave
//   and ends the run at once; the game-over screen is shown and the victory
//   screen is not.

import { it } from "vitest";

it("A fatal leak on the last wave is a loss, not a win", () => {
  throw new Error(
    "Meltdown: validation/waves/a-fatal-leak-on-the-final-wave-loses.test.ts is not implemented yet",
  );
});
