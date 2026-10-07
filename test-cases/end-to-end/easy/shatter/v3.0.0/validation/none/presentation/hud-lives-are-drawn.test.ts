// presentation/hud-lives-are-drawn — the HUD draws one glyph per ship in RESERVE,
// which is one fewer than the run has left.
//
// THE RULE. `specs/ui.md`: "Ships | One small ship glyph per ship in reserve, in a
// row below the score. That is one fewer than the total the run has left, since the
// ship being flown is on the field rather than in the row, so a game that has just
// started draws two glyphs and a game on its last ship draws none." The off-by-one
// is the whole of it: a build drawing `lives` glyphs tells the player they have one
// more ship than they do, and the row they are told to read is wrong exactly when it
// matters — on the last ship, where the specification says the row is empty.
//
// WHY A COUNT AND NOT A DIFFERENCE. Every differential reading passes the build that
// draws one glyph too many: it too adds one glyph per reserve ship and its row grows
// at the same rate. The only reading that separates them is an ABSOLUTE one, and the
// absolute one this check makes is how many glyphs' worth of ink the row carries at
// each of the three life counts: two, one, and none at all.
//
// HOW THE ROW IS FOUND, WITHOUT KNOWING WHERE THE BUILD PUT IT. `specs/ui.md` puts
// the HUD "in the upper portion of the field and clear of the field's centre" and
// says nothing else about the layout, so the row is located from the build's own
// drawing: the upper half of the field is read at three life counts, and the cells
// that carry ink at `START_LIVES` and none at one ship left are exactly the two
// glyphs that the reserve put there. Their rows give the BAND the row occupies and
// their columns give the WINDOW it runs in, widened by one glyph's pitch each way —
// so a build that drew a glyph too many, on either side of the two the reserve
// added, has it inside the window and is counted.
//
// AND WIDENED BY ONLY ONE PITCH, so a further readout of the build's own — which
// `specs/ui.md` explicitly welcomes on the HUD — cannot be counted as a ship unless
// the build put it inside the ship row itself.
//
// HOW A GLYPH IS COUNTED, AND WHY THE GLYPH IS MEASURED RATHER THAN NAMED. The two
// glyphs the reserve added are the build's own drawing of one, so the ink they carry,
// halved, is what ONE glyph of this build costs in cells. The row's own ink is then
// read against that: a row carrying two glyphs' worth of ink holds two glyphs, one
// carrying none holds none. `specs/overview.md` lets a build paint what it likes
// behind its HUD, and at the level below which a sampling cannot tell a drawing from
// the rounding of a channel a speck of a starfield is ink like any other — but a
// speck is a cell or two where a glyph is scores of them, so a decorated field moves
// the count by a fraction of a glyph and never by one.
//
// THE READING IS OF INK RATHER THAN OF COLOUR, and each cell carries the FURTHEST
// any pixel in it fell from the field the build drew, so a glyph drawn as a thin
// outline reads as strongly as one drawn filled. No palette is asserted: what is
// asked is that a mark is there, not what colour it is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  sampleField,
  startPlaying,
  type Harness,
} from "../harness";
import { changedCells, inkedInBand, readInk, type InkGrid } from "./ink";
import { clearOfStar, HUD_REGION, SHIP_SPOT } from "./scene";

/** The life counts read, and how many reserve glyphs each must draw. */
const READINGS = [
  { lives: START_LIVES, glyphs: START_LIVES - 1 },
  { lives: 2, glyphs: 1 },
  { lives: 1, glyphs: 0 },
] as const;

/**
 * One cell of the reading, in logical units.
 *
 * Two units: a glyph of a ship drawn against the specification's own rough hull —
 * `34` long and `26` across (`specs/ship.md`) — at any scale a HUD would use spans
 * several of these, and the gap `specs/ui.md`'s row leaves between two of them spans
 * several more.
 */
const CELL = 2;

/**
 * The sensing floor: how far a square unit's reading must sit from the field the
 * build drew before the cell can be called painted, of the 441 an RGB distance can
 * span.
 *
 * Eight. Below that a sampling cannot tell a drawing from the rounding of an 8-bit
 * channel and the host's own anti-aliasing; above it nothing is decided about how
 * strongly the mark reads. Anything the build painted over the sample clears it,
 * in whatever colour it chose, over whatever field it chose.
 */
const INK = 8;

/**
 * The sensing floor on a change: how far a reading must move between two frames
 * before the move can be called a redrawing, of the 441 an RGB distance can span.
 *
 * Eight. Below that a sampling cannot tell a redrawing from the rounding of an
 * 8-bit channel and the host's own anti-aliasing; above it nothing is decided
 * about how strongly the two readings differ. Anything the build drew differently
 * clears it, however faintly it drew it.
 */
const CHANGE = 8;

/** The score posed, so the HUD has its other readout drawn throughout. */
const SCORE = 730;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("draws two reserve glyphs at three ships, one at two, and none at one", async () => {
  await startPlaying(harness);
  await harness.debug.setScore(SCORE);
  // Off the upper half entirely, so the ship on the field cannot be read as a glyph
  // in the row it is counted out of.
  await harness.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);

  const field = await sampleField(harness);
  const grids = new Map<number, InkGrid>();
  for (const { lives } of READINGS) {
    await harness.debug.setLives(lives);
    await harness.advance(1);
    grids.set(lives, await readInk(harness, HUD_REGION, CELL, field));
    // Overwritten each time round, so what is kept is the last count that RAN.
    await captureStill(harness, "hud");
  }

  const full = grids.get(START_LIVES);
  const last = grids.get(1);
  if (full === undefined || last === undefined) {
    fail("three readings of the HUD", "one of them was not taken");
  }

  const reserve = changedCells(last, full, CHANGE, clearOfStar);
  if (reserve.length === 0) {
    fail(
      `a row of reserve-ship glyphs in the HUD that answers the ship count, so ${START_LIVES} ships draw ${START_LIVES - 1} glyphs and one ship draws none (specs/ui.md)`,
      `nothing in the upper portion of the field was drawn differently at ${START_LIVES} ships from at one`,
    );
  }

  const fromRow = Math.min(...reserve.map((cell) => cell.row));
  const toRow = Math.max(...reserve.map((cell) => cell.row));
  const leftCol = Math.min(...reserve.map((cell) => cell.col));
  const rightCol = Math.max(...reserve.map((cell) => cell.col));
  // The two glyphs the reserve added span this window, so half of it is one glyph's
  // pitch — which is how far the window is widened each way to catch a glyph the
  // build drew beyond them.
  const pitch = Math.ceil((rightCol - leftCol + 1) / 2);
  const band = {
    fromRow,
    toRow,
    fromCol: leftCol - pitch,
    toCol: rightCol + pitch,
  };

  // What one glyph of this build costs, in cells: the ink the reserve added between
  // one ship and START_LIVES, over the glyphs those ships put in the row.
  const added = READINGS[0].glyphs - READINGS[READINGS.length - 1].glyphs;
  const glyphInk = reserve.length / added;

  for (const { lives, glyphs } of READINGS) {
    const grid = grids.get(lives);
    if (grid === undefined) continue;
    assertEqual(
      Math.round(inkedInBand(grid, band, INK) / glyphInk),
      glyphs,
      `the glyphs' worth of ink the build drew in its reserve-ship row with ${lives} ship(s) left, against the ${glyphInk.toFixed(1)} cells one of its own glyphs carries, where one glyph is drawn per ship in reserve (specs/ui.md)`,
    );
  }
});
