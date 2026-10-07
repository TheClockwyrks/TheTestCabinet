// Floe (instrumentation) — the one arrangement the four "leaves the rest standing"
// checks share. CASE-PROVIDED.
//
// `clearVehicles`, `clearFloes`, `clearBears` and `removeCritter` each name what
// they take off AND what they leave behind (specs/instrumentation.md), so each of
// those four points needs the same thing: a strait carrying one of everything at
// once, with nothing on it moving between the reading before the call and the
// reading after it. Written once here rather than four times over, because the
// four are only comparable if the strait they are read on is the same strait.
//
// WHY NOTHING MOVES. Every lane is laid through `poseLane`, which parks it at a
// speed of `0` first — "A speed of `0` holds the lane where it stands. Every item
// of the lane keeps its exact position" — and every bear is posed with its three
// faculties held off, so the survivors can be held to being UNTOUCHED rather than
// merely to being still there. A check that wants one lane running releases it
// itself, afterwards, by name.
//
// WHERE THE BODIES STAND. The critter and both bears stand on the ice band, whose
// footing no floe decides, so nothing the snapshot derives from the water band
// moves when the water band does. Neither bear shares a row with the critter, and
// no row carries both a bear and the lane a check releases.
//
// It poses and returns; it runs no frame, asserts nothing, and carries no
// tolerance.

import {
  poseBear,
  poseLane,
  startCrossing,
  type FloeKind,
  type Harness,
  type VehicleKind,
} from "../harness";

/** The three ice lanes carrying a vehicle, and the column each stands at. */
export const VEHICLES: readonly (readonly [number, VehicleKind, number])[] = [
  [12, "car", 20],
  [15, "car", 6],
  [17, "plow", 30],
];

/** The three water lanes carrying a floe, and the column each stands at. */
export const FLOES: readonly (readonly [number, FloeKind, number])[] = [
  [3, "raft4", 10],
  [6, "raft4", 24],
  [9, "raft4", 34],
];

/** The two tiles the bears settle on, both on the ice band, clear of the critter. */
export const BEAR_TILES: readonly (readonly [number, number])[] = [
  [5, 15],
  [30, 12],
];

/** Where the critter stands: an ice row no posed lane item shares. */
export const CRITTER_COL = 24;
export const CRITTER_ROW = 14;

/** The bays posed filled, and the bay the posed bonus catch sits in. */
export const FILLED_BAYS: readonly number[] = [0, 3];
export const FISH_BAY = 1;

/** What the arrangement put on the strait, by the ids the poses handed back. */
export interface Crowded {
  vehicles: number[];
  floes: number[];
  bears: number[];
}

/** Pose the shared strait: one of everything, and none of it moving. */
export function poseCrowdedStrait(h: Harness): Crowded {
  startCrossing(h);

  const vehicles: number[] = [];
  for (const [row, kind, col] of VEHICLES) {
    vehicles.push(...poseLane(h, row, kind, [col]));
  }
  const floes: number[] = [];
  for (const [row, kind, col] of FLOES) {
    floes.push(...poseLane(h, row, kind, [col]));
  }
  const bears = BEAR_TILES.map(([col, row]) =>
    poseBear(h, col, row, { sense: false, routing: false, travel: false }),
  );

  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  for (const bay of FILLED_BAYS) h.debug.setBay(bay, true);
  h.debug.setFishBay(FISH_BAY);

  return { vehicles, floes, bears };
}
