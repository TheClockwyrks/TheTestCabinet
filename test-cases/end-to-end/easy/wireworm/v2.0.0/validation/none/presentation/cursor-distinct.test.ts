// Wireworm — presentation/cursor-distinct: the cursor reads apart from its band.
//
// specs/overview.md's legibility table: "The cursor reads apart from the player
// band it sits in." The cursor never leaves that band (specs/cursor.md clamps it
// to the band's four bounds), so the band is the only ground it is ever seen
// against, and a cursor the colour of its own floor is a cursor the player
// cannot aim. The specification fixes no palette, so what is checked is DISTANCE
// between the colour the cursor paints and the colour the band carries beside
// it.
//
// THE BAND IS SAMPLED WELL AWAY FROM THE CURSOR, and on the same line through
// it: `startPlaying` rests the cursor at the band's centre, `(640, 688)`, and
// the band tint is read at the far left of the same band, `440` units away, so
// no glow a build lays around the cursor reaches the sample and no vertical
// difference in the band's own tint is read as the cursor.
//
// NOTHING ELSE IS ON THE BOARD. `startPlaying` leaves no node, worm, foe or
// bolt, and clears the cursor's spawn-in invulnerability, so the cursor is drawn
// as it is drawn in play rather than in the pulse or blink a build may give an
// invulnerable one.
//
// The colour of the cursor and of the band is the colour of its LIT MARK, read
// as `presentation/reading` explains, so the cursor's own figure is compared
// against the floor's own rather than against the board showing through it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BAND_CX, BAND_CY, CURSOR_Y_MAX, CURSOR_Y_MIN } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { litColor, pointBox, rgb } from "./reading";

/**
 * How far apart the cursor and its band must read, as a Euclidean RGB distance
 * out of the `441` an RGB cube is across. The case's figure, since the
 * specification states the rule and leaves the palette to the build: `40` is
 * about a tenth of the space, which is the least a player reads at a glance.
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

afterEach(async () => {
  await h?.dispose();
});

it("draws the cursor apart from the band it sits in", async () => {
  await startPlaying(h);
  await h.advance(1);
  // The cursor resting at the centre of its band.
  await captureStill(h, "cursor");

  const { cursor } = await h.snapshot();
  assertEqual(cursor.x, BAND_CX, "the cursor rests at the band's centre x");
  assertEqual(cursor.y, BAND_CY, "the cursor rests at the band's centre y");
  assertEqual(cursor.invulnerable, 0, "the cursor carries no invulnerability");

  const drawn = await litColor(h, pointBox(cursor.x, cursor.y));
  const band = await litColor(h, pointBox(BAND_SAMPLE_X, cursor.y));
  assertGreaterThan(
    colorDistance(drawn, band),
    DISTINCT_MIN,
    `the cursor to differ from the band tint beside it by more than ` +
      `${DISTINCT_MIN} of 441 (specs/overview.md: the cursor reads apart from ` +
      `the player band it sits in); the cursor at (${cursor.x}, ${cursor.y}) ` +
      `sampled ${rgb(drawn)} and the band at (${BAND_SAMPLE_X}, ${cursor.y}) ` +
      `— inside the band, whose centres run y ${CURSOR_Y_MIN}..` +
      `${CURSOR_Y_MAX} — sampled ${rgb(band)}`,
  );
});
