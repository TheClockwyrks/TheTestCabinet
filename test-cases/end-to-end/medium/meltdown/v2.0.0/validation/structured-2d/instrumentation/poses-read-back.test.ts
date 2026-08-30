// Meltdown — instrumentation/poses-read-back: every pose is reported by the
// snapshot.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Each pose operation's value is read back: screen, phase, menu index, mode,
//   difficulty, money, lives, score, wave, build timer, wave pending, speed,
//   selection, shop hover, the armed type, the preview's tile and rotation, a
//   tower's heat, level, freshness, tripped flag, trip timer and both faculty
//   gates, a unit's position, hp, max hp, slow, slow timer and its gate, the
//   pointer's position and press state, and the world gate. Mute is not in the
//   list: there is no setMuted.

import { it } from "vitest";

it("Every pose is reported by the snapshot", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/poses-read-back.test.ts is not implemented yet",
  );
});
