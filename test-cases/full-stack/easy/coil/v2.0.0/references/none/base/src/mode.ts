// Coil — the build's single playable mode (specs/gameplay.md).
//
// A build implements exactly ONE mode, selected here. This is the `base` build, so it is
// Classic: the open board, no interior obstacles, and a title menu that lists CLASSIC.
// The Maze logic (the four fatal obstacle bars) lives in the same codebase (see
// `MAZE_OBSTACLES` in constants.ts and the `obstacles` handling in sim.ts) and is gated
// entirely on this constant, so the only difference between the `base` and `maze` builds
// is this one line — the `maze` reference-impl is a copy of this project with `MODE` flipped.
export type Mode = "classic" | "maze";

export const MODE: Mode = "classic";
