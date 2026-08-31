// presentation/hud-score-is-drawn — the score is on the screen, where the HUD goes.
//
// THE RULE. `specs/ui.md`: "Score | The running score, as digits, at the top left.
// It is the most prominent of the readouts." and, of the HUD as a whole, "The HUD is
// drawn over the `playing` screen, in the upper portion of the field and clear of
// the field's centre." `specs/overview.md` repeats the second half: "nothing of the
// HUD is drawn over the field's centre". A score the player cannot see is a game
// with nothing to play for; a score drawn across the middle of the field is a score
// drawn over the star and the rocks.
//
// WHAT IS READ. The runs of text the frame drew, with their anchors mapped through
// whatever transform was in force at each (`textDraws`, `validation/none/harness.ts`).
// At the harness's own shape the canvas is the field at one unit per pixel, so a
// run's anchor and its measured box are directly comparable with the figures
// `specs/overview.md` fixes. The check is for a run CONTAINING the posed digits, not
// for one equal to them: a build is free to draw its score padded, or with a label
// beside it in the same run.
//
// THE TWO PLACEMENT BOUNDS, EACH TAKEN FROM A SPECIFICATION SENTENCE. "In the upper
// portion of the field" is the top half. "Clear of the field's centre" is stated
// nowhere as a number, so it is taken as the one extent the specification DOES fix
// about the middle of the field: nothing of the star is drawn beyond `1.5 x HALO_R`
// (`180`, `specs/field.md`), and a readout outside that is clear of the centre in
// the only sense the specification measures. The distance is taken from the run's
// whole measured box rather than from its anchor, so a run that is centred or
// right-aligned is judged by where its glyphs land.
//
// THE SCORE POSED IS `730`: three digits, so no build's thousands separator can
// break the string being looked for, and a figure that appears nowhere else on a
// field posed like this — the wave is `1`, the lives are `3` and the field is empty.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { FIELD_H, STAR_DRAW_R } from "../constants";
import { segmentDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";
import { FAR_SHIP, STAR } from "./scene";

/** The score posed for the reading. See the header for why this figure. */
const SCORE = 730;

/** The bottom of the upper portion of the field, in logical units. */
const UPPER_PORTION = FIELD_H / 2;

/**
 * How far the score's glyphs must stay from the field's centre, in logical units.
 *
 * `STAR_DRAW_R` — the `180` beyond which `specs/field.md` says nothing of the star
 * is drawn, and so the only figure the specification gives for how far the middle of
 * the field reaches.
 */
const CLEAR_OF_CENTRE = STAR_DRAW_R;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** How far a run's drawn glyphs are from the field's centre. */
function fromCentre(run: TextDraw): number {
  return segmentDistance(
    { x: run.left, y: run.y },
    { x: run.right, y: run.y },
    STAR,
  );
}

it("draws the posed score in the upper portion of the field, clear of its centre", async () => {
  await startPlaying(harness);
  await harness.debug.setScore(SCORE);
  // Parked away from the HUD, so nothing the ship is drawn as can be mistaken for a
  // readout in the picture this leaves behind.
  await harness.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);

  const runs = textDraws(await harness.frameCalls());
  await captureStill(harness, "hud");

  const digits = runs.filter((run) => run.text.includes(String(SCORE)));
  assertTrue(
    digits.length > 0,
    `the score ${SCORE} drawn as digits somewhere on the playing screen (specs/ui.md); the runs of text the frame drew were ${JSON.stringify(runs.map((run) => run.text))}`,
  );

  const placed = digits.filter(
    (run) => run.y <= UPPER_PORTION && fromCentre(run) > CLEAR_OF_CENTRE,
  );
  assertTrue(
    placed.length > 0,
    `the score drawn in the upper portion of the field (above y ${UPPER_PORTION}) and more than ${CLEAR_OF_CENTRE} from its centre (specs/ui.md); it was drawn at ${JSON.stringify(digits.map((run) => ({ y: Math.round(run.y), fromCentre: Math.round(fromCentre(run)) })))}`,
  );
});
