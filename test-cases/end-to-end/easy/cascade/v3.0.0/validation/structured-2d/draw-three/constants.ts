// Cascade — Draw Three's own figures. CASE-PROVIDED.
//
// The four deal-mode figures `specs/stock.md` and `specs/table.md` fix for this
// variant, transcribed here rather than read from the build for the reason
// `validation/structured-2d/constants.ts` gives at length: a figure taken from
// `src/constants.ts` is the graded thing's account of itself, and a build that
// fans its waste at a pitch of 29 and writes `WASTE_FAN = 29` would agree with
// itself exactly.
//
// THIS DIRECTORY IS THE ONLY PLACE A DRAW THREE LITERAL BELONGS. The ten checks
// beside this file are the ones whose requirement IS the deal mode, and they are
// the only checks in the project that may write `3` for a turn count. Every
// common check reads `snapshot().turnCount` or `snapshot().dealMode` instead, so
// one suite stays honest across both variants; `deal-mode-reported` is what pins
// that reading to the figures below.

import { WASTE_X } from "../constants";

/** Cards one turn of the stock moves onto the waste. */
export const TURN_COUNT = 3;

/** The identifier a Draw Three build reports for its deal mode. */
export const DEAL_MODE = "draw-three";

/** The text a Draw Three build draws on the title screen and in the HUD. */
export const DEAL_MODE_LABEL = "DRAW THREE";

/**
 * The pitch the waste's shown set fans to the right at (`specs/table.md`).
 *
 * The shown cards are drawn oldest first from the waste anchor, so with three
 * shown their top-left corners are at `346`, `372` and `398` and the last of
 * them is the waste's top card.
 */
export const WASTE_FAN = 26;

/** The left edge of the `i`th card of the shown fan, `i` counted oldest first. */
export function fanCardX(i: number): number {
  return WASTE_X + i * WASTE_FAN;
}
