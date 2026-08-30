// Meltdown — modes/replay-keeps-the-mode: play Again replays the same mode and
// difficulty.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Confirming PLAY AGAIN on either end screen opens a fresh run on the mode
//   and difficulty the run was on, with that pair's starting money and lives.
//   Restart from the pause menu is screens.pause-restart's requirement, not
//   this one's.

import { it } from "vitest";

it("Play Again replays the same mode and difficulty", () => {
  throw new Error(
    "Meltdown: validation/modes/replay-keeps-the-mode.test.ts is not implemented yet",
  );
});
