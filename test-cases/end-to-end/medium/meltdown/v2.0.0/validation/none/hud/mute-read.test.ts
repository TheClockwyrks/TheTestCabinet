// Meltdown — hud/mute-read: the mute control shows its state.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   The control reads plainly differently muted and unmuted, and changes on
//   the frame muted does. It drives the state through the mute key alone; that
//   the control itself toggles mute is controls.mute-control's requirement.

import { it } from "vitest";

it("The mute control shows its state", () => {
  throw new Error(
    "Meltdown: validation/hud/mute-read.test.ts is not implemented yet",
  );
});
