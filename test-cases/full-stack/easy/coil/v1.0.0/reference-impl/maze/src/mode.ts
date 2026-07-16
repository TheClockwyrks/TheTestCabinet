// Coil — the build's single playable mode (specs/mode-base.md, specs/mode-maze.md).
//
// A build implements exactly ONE mode, selected here. This is the `maze` build, so it is
// Maze: the enclosed board laced with the four fixed, fatal interior obstacle bars, and a
// title menu that lists MAZE. The Maze logic (the obstacle bars) lives in the same codebase
// (see `MAZE_OBSTACLES` in constants.ts and the `obstacles` handling in sim.ts) and is gated
// entirely on this constant, so the only difference between the `base` and `maze` builds
// is this one line — the `maze` reference-impl is a copy of the `base` project with `MODE` flipped.
export type Mode = "classic" | "maze";

export const MODE: Mode = "maze";
