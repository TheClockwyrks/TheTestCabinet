// Spectra — swarm/formation: every slot of the grid, filled. LOCAL TO THIS GROUP.
//
// The two dive-timing points — `swarm/dive-first-delay` and `swarm/dive-cadence` —
// pose a COMPLETE formation before they open the dive gate, because
// specs/swarm.md's launch "takes one drone resting in the formation, chosen at
// random from those standing": a wave that has run out of standing drones launches
// nothing, and a point about WHEN a launch is due must never be decided by how many
// drones were left to launch.
//
// It is geometry alone — `FORM_COLS` by `FORM_ROWS` of `slotX`/`slotY` from
// specs/field.md — and it holds no threshold. A point that wants a different
// composition writes its own entries, as `swarm/only-divers-fire` does.

import { FORM_COLS, FORM_ROWS } from "../../src/constants";
import type { DroneKind, DronePose, FormationEntry } from "../harness";

/**
 * Every slot of the grid, filled with one kind and one pose.
 *
 * The pose defaults to what {@link poseDrone} leaves behind — phase `formation`,
 * all three faculties off — so a complete block posed this way stands exactly
 * where it was put until something the check asked for moves it.
 */
export function fullFormation(
  kind: DroneKind = "shard",
  pose: DronePose = {},
): FormationEntry[] {
  const entries: FormationEntry[] = [];
  for (let row = 0; row < FORM_ROWS; row += 1) {
    for (let col = 0; col < FORM_COLS; col += 1) {
      entries.push({ ...pose, kind, col, row });
    }
  }
  return entries;
}
