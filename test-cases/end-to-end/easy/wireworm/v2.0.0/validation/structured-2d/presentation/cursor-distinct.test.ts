// Wireworm — presentation/cursor-distinct: the cursor reads apart from its band.
//
// specs/overview.md's legibility table: "The cursor reads apart from the player
// band it sits in." The cursor never leaves that band (specs/cursor.md clamps
// it to the band's four bounds), so the band is the only ground it is ever seen
// against, and a cursor the colour of its own floor is a cursor the player
// cannot aim. The specification fixes no palette, so what is checked is
// DISTANCE between the colour the cursor paints and the colour the band carries
// beside it.
//
// THE BAND IS SAMPLED WELL AWAY FROM THE CURSOR, and on the same line through
// it: `startPlaying` rests the cursor at the band's centre, and the band tint is
// read at the far left of the same band, `440` units away, so no glow a build
// lays around the cursor reaches the sample and no vertical difference in the
// band's own tint is read as the cursor.
//
// NOTHING ELSE IS ON THE BOARD. `startPlaying` leaves no node, worm, foe or
// bolt, and clears the cursor's spawn-in invulnerability, so the cursor is drawn
// as it is drawn in play rather than in the pulse or blink a build may give an
// invulnerable one.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_Y_MAX, CURSOR_Y_MIN } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  colorDistance,
  createHarness,
  resetTo,
  sampleColor,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far apart the cursor and its band must read, as a Euclidean RGB distance
 * out of the `441` an RGB cube is across. The case's figure, since the
 * specification states the rule and leaves the palette to the build.
 */
const DISTINCT_MIN = 40;

/**
 * Where the band's own tint is read: the far left of the band, on the line
 * through the cursor's centre.
 *
 * `200` is well inside the band, which runs the full width of the board
 * (specs/board.md), and `440` units from the cursor resting at the band's
 * centre — far past any glow a build could lay around a `24`-unit cursor.
 */
const BAND_SAMPLE_X = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the cursor apart from the band it sits in", async () => {
  resetTo(h);
  startPlaying(h);
  await h.advance(1);
  // The cursor resting at the centre of its band.
  captureStill(h, "cursor");

  const { cursor } = h.snapshot();
  assertEqual(cursor.x, BAND_CX, "the cursor rests at the band's centre x");
  assertEqual(cursor.y, BAND_CY, "the cursor rests at the band's centre y");
  assertEqual(cursor.invulnerable, 0, "the cursor carries no invulnerability");

  const drawn = sampleColor(h, cursor.x, cursor.y);
  const band = sampleColor(h, BAND_SAMPLE_X, cursor.y);
  assertGreaterThan(
    colorDistance(drawn, band),
    DISTINCT_MIN,
    `the cursor to differ from the band tint beside it by more than ` +
      `${DISTINCT_MIN} of 441 (specs/overview.md: the cursor reads apart from ` +
      `the player band it sits in); the cursor at (${cursor.x}, ${cursor.y}) ` +
      `sampled rgb(${drawn.r.toFixed(0)}, ${drawn.g.toFixed(0)}, ` +
      `${drawn.b.toFixed(0)}) and the band at (${BAND_SAMPLE_X}, ${cursor.y}) ` +
      `— inside the band, whose centres run y ${CURSOR_Y_MIN}..` +
      `${CURSOR_Y_MAX} — sampled rgb(${band.r.toFixed(0)}, ` +
      `${band.g.toFixed(0)}, ${band.b.toFixed(0)})`,
  );
});
