// Coil — the one mode this build ships (specs/mode.md).
//
// A build plays exactly one mode, and this file is the whole of the difference
// between the two: everything below is derived from `MODE`, so the two builds are
// byte-identical apart from that single line. Classic leaves the interior open;
// Maze lays the four fatal bars `MAZE_OBSTACLES` holds across it.

import { MAZE_OBSTACLES, type Cell } from "./constants";

/** The modes the codebase knows how to play. */
export type Mode = "classic" | "maze";

// The one line the two builds differ on. It is written through the union rather
// than as a bare literal so the derivations below stay live in both of them.
/** The mode this build ships. */
export const MODE = "classic" as Mode;

/** The title menu's first item, above `HOWTO_ITEM`. */
export const MODE_ITEM = MODE === "maze" ? "MAZE" : "CLASSIC";

/** The mode readout in the HUD. */
export const MODE_LABEL = MODE_ITEM;

/** Whether this mode lays obstacle cells across the interior at all. */
export const HAS_OBSTACLES = MODE === "maze";

/** The course a round opens with, which is empty in a mode that lays none. */
export const OBSTACLE_CELLS: readonly Cell[] =
  MODE === "maze" ? MAZE_OBSTACLES : [];
