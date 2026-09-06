// Fathom — where the frame put its text. CASE-PROVIDED.
//
// Five points read a run of text as a PLACE rather than as a word: the menu
// reading has to contain the point an item was drawn at, and the HUD's readouts
// have to sit in the strip specs/ui.md gives them. Reading a `fillText` call's
// own arguments cannot answer either, because a build is free to draw under a
// transform — to translate to a HUD corner and draw at the origin, say — so the
// position a call names is only where the text landed once the transform in force
// at that call is applied.
//
// So this module answers one question: for each run of text the frame drew, where
// on the stage did it land, and how wide is it? Its counterpart in `states/` reads
// the same calls for their WORDS, which is a different question and needs none of
// this.
//
// THE READING IS THE SHARED HARNESS'S. `@clockwyrks/case-harness`'s `textDraws`
// places one entry per `fillText`/`strokeText` call, mapping each anchor through
// the transform in force at it and extending the run by its measured width under
// the alignment that placed it — which is exactly what this file used to spell.
// Under an engine the recorder takes that transform off the real context at the
// moment of the call (`harness.ts` asks for `measureText`), so the placement is
// arithmetic on what the call itself carried rather than a replay of the frame.
//
// THE RESULT IS IN LOGICAL UNITS at the shape every check in this project builds
// its harness at: the canvas is the stage's own size at a device pixel ratio of
// one, so the engine's viewport transform is the identity and a device pixel is a
// logical unit. A check that builds a harness at some other shape reads the
// picture through `h.device` instead, and none of the points that use this module
// does.

export { textDraws, type TextDraw } from "./case-harness/text";
