// Midway — the park START this build plays (specs/mode-classic.md; DESIGN.md §1).
//
// THE START IS ISOLATED TO THIS CONFIG, exactly as valence's mode.ts isolates its
// campaign. The `base` variant is NEW PARK: a fresh green plot with the entrance gate + a
// small paved plaza already down, a starting loan of START_CASH, and NO rides, stalls, or
// staff. Every common system (park.md ... flow.md) runs with no overrides. The `downpour`
// sibling flips a single flag to layer the weather system on top, so the interface
// reserves `weather` even though base leaves it off — a config change, not a rewrite.

import { TUNE } from "./constants";

export interface Mode {
  slug: string;
  menuLabel: string; // the main-menu entry for this start
  tagline: string;
  startCash: number; // opening balance (a starting loan)
  weather: boolean; // downpour layers the weather system on top; base = false
}

export const MODE: Mode = {
  slug: "base",
  menuLabel: "NEW PARK",
  tagline: "A FRESH GREEN PLOT — GROW IT INTO A PARK",
  startCash: TUNE.economy.startCash, // 4000
  weather: false,
};
