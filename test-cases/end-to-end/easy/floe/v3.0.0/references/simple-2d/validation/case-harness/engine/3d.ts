// @clockwyrks/case-harness/engine/3d — what only a 3D engine harness needs.
//
// Kept out of `./index` so a 2D case reaches the neutral half without any of it,
// exactly as `./2d` is kept out for the mirror reason.
//
// WHAT A 3D PROJECT HAS THAT A 2D ONE DOES NOT: a renderer that wants a WebGL2
// context, and a `self` that three's disposal path reaches for. Both are here.
//
// WHAT A 3D PROJECT DOES NOT HAVE, AND WHY IT SHIPS NO REPLAY. A 3D engine's
// `stopRecording` answers a PROMISE of VP9 video, encoded through WebCodecs,
// which Node carries none of — and its contract declares no `DrawOp`,
// `DrawState`, `PathSegment` or `CapturedImage`, so there is no draw-op log for
// `./replay`'s thinning and re-tabling to operate on. A 3D case therefore
// captures STILLS only, through `./capture`'s neutral writers over whatever its
// screen layer encodes, and says so where its `captureStill` is declared. That is
// what the two 3D harnesses in the tree already do, and it is a fact about the
// engine rather than a gap in this package.

export * from "./webgl";
