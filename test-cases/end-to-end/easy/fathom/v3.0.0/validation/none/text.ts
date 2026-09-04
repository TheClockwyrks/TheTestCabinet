// Fathom — where the frame put its text. CASE-PROVIDED.
//
// Four points read a run of text as a PLACE rather than as a word: the menu
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
// UNDER `none` THE SHARED HARNESS ALREADY WALKS THE TRANSFORM. The recorder in
// `@test-cabinet/case-harness` keeps every operation of a frame in order, and its
// `textDraws` carries the transform through `save`/`restore` and every operation
// that moves it, so a run comes back placed in canvas pixels — which, at the shape
// every check in this project builds its harness at, is the logical stage at one
// pixel per unit. This file is that reading under Fathom's own name.

export {
  drawnTextRuns as textRuns,
  textDraws,
  type TextDraw,
} from "./case-harness/index";
