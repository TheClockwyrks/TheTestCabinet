// Coil — what the mode this build ships means for the rest of it (specs/mode.md).
//
// `src/constants.ts` fixes the mode itself: its copy, and the interior cells it
// lays as obstacles. The one thing derived from it lives here rather than beside
// the game, because both the renderer and the debug surface read it while their
// own modules are still being evaluated, and a constant every module can reach
// without reaching the game is what keeps that free of an import cycle.

import { OBSTACLE_CELLS } from "./constants";

/**
 * Whether this build's mode lays a course of obstacle cells across the board.
 *
 * A mode that lays none carries no obstacle operations on its debug surface and
 * tells the player about the wall and its own body alone.
 */
export const HAS_OBSTACLES = OBSTACLE_CELLS.length > 0;
