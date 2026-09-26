// Cascade — Draw One's own figures. CASE-PROVIDED.
//
// The three deal-mode figures `specs/stock.md` fixes for this variant,
// transcribed here rather than read from the build for the reason
// `validation/structured-2d/constants.ts` gives at length: a figure taken from
// `src/constants.ts` is the graded thing's account of itself, and a build that
// turns two cards and writes `TURN_COUNT = 2` would agree with itself exactly.
//
// THIS DIRECTORY IS THE ONLY PLACE A DRAW ONE LITERAL BELONGS. The six checks
// beside this file are the ones whose requirement IS the deal mode, and they are
// the only checks in the project that may write `1` for a turn count. Every
// common check reads `snapshot().turnCount` or `snapshot().dealMode` instead, so
// one suite stays honest across both variants; `deal-mode-reported` is what pins
// that reading to the figures below.

/** Cards one turn of the stock moves onto the waste. */
export const TURN_COUNT = 1;

/** The identifier a Draw One build reports for its deal mode. */
export const DEAL_MODE = "draw-one";

/** The text a Draw One build draws on the title screen and in the HUD. */
export const DEAL_MODE_LABEL = "DRAW ONE";
