// Junction — the `base` start this build plays (specs/mode.md, DESIGN §1, §4).
//
// THE START CONFIG IS ISOLATED TO THIS FILE. Only the starting valley seed, the modest
// starting treasury, the default tax rate, the already-positive opening RCI demand, the
// short pre-placed road stub, and the camera focus live here; every other system — the
// tile map, zoning/development, transit + congestion, power/water, the demand/budget
// economy, the states and HUD — is common (specs/mode-standard.md). A different mode would
// change only the values below.

import { START_TREASURY, TAX_DEFAULT } from "./constants";
import type { Rci } from "./types";

// A short pre-placed horizontal road run (in tile coords) the player builds out from, so
// the opening screen is not empty land (specs/mode.md).
export interface RoadStub {
  col: number; // left tile of the run
  row: number;
  len: number; // tiles laid to the right
}

export interface CityMode {
  slug: string;
  menuLabel: string; // main-menu entry (specs/mode.md) — shown before HOW TO PLAY
  tagline: string; // title-screen tagline
  seed: number; // deterministic valley (river/hills), reproducible for the proof captures
  startTreasury: number;
  startTax: number;
  startRci: Rci; // opening demand — positive so zoning develops from the first months
  stub: RoadStub;
  centerCol: number; // camera focus on load (near the stub — specs/map.md)
  centerRow: number;
}

export const MODE: CityMode = {
  slug: "base",
  menuLabel: "NEW CITY",
  tagline: "ZONE. CONNECT. GROW.",
  seed: 0x4a55_4e43, // "JUNC"
  startTreasury: START_TREASURY,
  startTax: TAX_DEFAULT,
  // The region opens hungry for all three: jobs and homes and works are all wanted, so the
  // first zoned blocks develop while the player lays their first networks (specs/mode.md).
  startRci: { r: 46, c: 30, d: 24 },
  stub: { col: 44, row: 36, len: 9 },
  centerCol: 48,
  centerRow: 36,
};
