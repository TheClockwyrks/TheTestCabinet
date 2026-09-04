// presentation/hud-lives-are-drawn — the HUD draws one glyph per ship in RESERVE.
//
// THE RULE. `specs/ui.md`: "Ships | One small ship glyph per ship in reserve, in a
// row below the score. That is one fewer than the total the run has left, since
// the ship being flown is on the field rather than in the row, so a game that has
// just started draws two glyphs and a game on its last ship draws none." The
// off-by-one is the whole point of the item: a player on their last ship must be
// able to see that they are, and a build drawing `lives` glyphs instead of
// `lives - 1` tells them they have one in hand when they do not.
//
// THREE POSED VALUES, AND WHY THREE. `setLives` poses the count and nothing else
// (`specs/instrumentation.md`), so the row is read at three ships, at two and at
// one, and the counts must be two, one and none. Every wrong model reads as a
// different set of three numbers: a build drawing one glyph per ship LEFT reads
// `3, 2, 1`, one drawing a fixed row reads the same number three times, and one
// drawing no row at all reads `0, 0, 0`. A single posed value would separate none
// of them.
//
// WHERE THE ROW IS, AND WHY IT IS NOT ASSUMED. `specs/ui.md` puts the row "below
// the score" in the upper portion of the field and leaves everything else about
// the layout to the build, so nothing here may name a place. The row is FOUND
// instead: the square units of the HUD that are drawn differently at three ships
// from at one are the glyphs the second and third ship add, and the box that
// bounds them is where the row runs.
//
// AND WHY THAT BOX IS THEN WIDENED. The difference alone cannot tell one glyph per
// ship in RESERVE from one glyph per ship LEFT, because both models add exactly two
// glyphs between one ship and three — the off-by-one build simply draws them one
// slot further along, and a count taken inside the difference would read two, one
// and none for either. So the box is widened along the row by its own width on each
// side, which is two more glyph slots at each end, and the counts are taken there:
// the model that draws a glyph for the ship being flown has that extra glyph inside
// the widened box at every one of the three, and reads three, two and one.
//
// The widening is along the ROW only, and by the row's own length rather than by a
// figure of this check's choosing, so it reaches the slots a glyph could occupy and
// stops well short of the far side of the HUD.
//
// HOW A GLYPH IS COUNTED. `specs/ui.md` draws the glyphs "in a row", so they are
// separated marks along it: a column of the box counts as inked when anything in
// it is drawn, a run of inked columns is one mark, and a bare column between two
// runs separates them. Nothing about a glyph's shape, size or colour is read —
// `specs/overview.md` leaves the look to the build.
//
// THE POSE. An emptied, gated field on the `playing` screen with the score held at
// `0` across all three frames, so the score's own digits are identical on each and
// the only thing that changes between them is the count of ships. The field is
// empty and both world gates are shut, so nothing arrives to draw over the HUD.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  changedCells,
  marksInBand,
  readInk,
  readPainted,
  type InkGrid,
} from "./ink";
import { HUD_REGION, clearOfStar, sampleField } from "./scene";

/** How far a square unit must be from the field to count as drawn, of 441. */
const APART = 60;

/** The side of a square unit the HUD is read in, in logical units. */
const CELL = 1;

/**
 * How much a square unit's reading must move between two frames to count as
 * changed, of 441.
 *
 * Half the `60` a unit must sit from the field by to be called drawn, so a glyph
 * drawn faintly still marks the row out, and a build's own dithering does not.
 */
const CHANGE = 30;

/**
 * How many bare columns separate two marks along the row.
 *
 * One. `specs/ui.md` fixes that the glyphs are drawn "in a row" and nothing about
 * the spacing, so the least a row can be is glyphs with a column of field between
 * them, and that is what is required.
 */
const GAP = 1;

/** The counts of ships posed, and the reserve glyphs each must draw. */
const POSED = [
  { lives: 3, glyphs: 2 },
  { lives: 2, glyphs: 1 },
  { lives: 1, glyphs: 0 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws two reserve glyphs at three ships, one at two, and none at one", async () => {
  startPlaying(h);
  await h.advance(1);
  const field = sampleField(readPainted(h));

  const read: { lives: number; glyphs: number; grid: InkGrid }[] = [];
  for (const { lives, glyphs } of POSED) {
    h.debug.setLives(lives);
    await h.advance(1);
    read.push({
      lives,
      glyphs,
      grid: readInk(readPainted(h), HUD_REGION, CELL, field),
    });
  }
  captureStill(h, "hud");

  const most = read[0].grid;
  const least = read[read.length - 1].grid;
  const row = changedCells(least, most, CHANGE, clearOfStar);
  assertGreaterThan(
    row.length,
    0,
    "how many square units of the HUD are drawn differently at three ships " +
      "from at one, where one glyph per ship in reserve must be drawn " +
      "(specs/ui.md)",
  );

  const fromCol = Math.min(...row.map((cell) => cell.col));
  const toCol = Math.max(...row.map((cell) => cell.col));
  const reach = toCol - fromCol + 1;
  const band = {
    fromRow: Math.min(...row.map((cell) => cell.row)),
    toRow: Math.max(...row.map((cell) => cell.row)),
    fromCol: fromCol - reach,
    toCol: toCol + reach,
  };

  for (const { lives, glyphs, grid } of read) {
    assertEqual(
      marksInBand(grid, band, APART, GAP),
      glyphs,
      `with ${lives} ships, how many separated marks the row of reserve ` +
        "glyphs holds, which is one per ship in reserve and so one fewer " +
        "than the ships the run has left (specs/ui.md)",
    );
  }
});
