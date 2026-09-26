// @clockwyrks/case-harness/engine/2d — what only a 2D engine harness needs.
//
// Kept out of `./index` so a 3D case reaches the neutral half without any of it.
// Two things live here and both are 2D by nature rather than by accident. The
// canvas ITSELF is not one of them: all four engines draw through a 2D context —
// the two 3D ones over a screen layer beside their WebGL stub — so the canvas and
// its recorder are neutral and live in `./index`.
//
//   THE READINGS OVER THE CANVAS. Pixels, colours and placed text, taken synchronously,
//   because the canvas is in this process. These are the twins of `../color` and
//   `../text`'s browser-side readings and they share every pure part with them.
//
//   THE REPLAY STACK. A 2D engine's `stopRecording` answers a draw-op log in the
//   format the console's player reads, so this package's thinning and re-tabling
//   apply to it directly. A 3D engine's answers VP9 video and none of it applies.
//
// A case imports this barrel BESIDE `./index`, not instead of it.

export * from "./read";
export * from "./replay";
