// presentation/cursor-distinct — the cursor reads apart from the band.
//
// specs/overview.md's legibility table: "The cursor reads apart from the player
// band it sits in." The cursor is the one body a player is steering, and it
// spends the whole run inside a strip of the board that is drawn as a floor of
// its own (specs/board.md, and presentation's sibling point board/band-tinted),
// so of everything on the board it is the one whose ground is not the board.
// That is why the comparison is against the band and against nothing else.
//
// THE READING IS A COMPARISON, NEVER A COLOUR. specs/overview.md fixes no
// palette, so what is asserted is that the cursor differs from the band it is
// standing in — read off the SAME row of the band, well away along it, so a band
// drawn as two differently lit rows, or with a gradient across it, is read where
// the cursor actually is.
//
// THE CURSOR IS POSED ON A TILE CENTRE inside the band. `setCursor` applies the
// real clamp, and the centre of tile (20, 19) is `(656, 704)`, which is
// `CURSOR_Y_MAX` — inside the band on both axes, so the pose lands where it was
// asked. A tile centre is chosen because a build is free to rule its board along
// the tile boundaries, and a box taken about a tile centre is clear of any such
// ruling; the band the cursor is held against is read through a box of exactly
// the same shape, on a tile centre of the same row.
//
// The board is otherwise the empty, quiet one `startPlaying` opens, so nothing
// else is in the band and nothing arrives into it.

import { afterEach, beforeEach, it } from "vitest";
import { ROWS } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { litColor, tileBox } from "./reading";

/**
 * How far the cursor must read from the band, in RGB distance on the 0–441
 * scale.
 *
 * `441` is the whole scale, `sqrt(3) * 255`. specs/overview.md requires the
 * cursor to "read apart" from the band and fixes no colour, so the bar is what a
 * measurement can honestly call a different colour rather than a shade of the
 * same one: 40 is under a tenth of the scale, comfortably below anything
 * legible. It is the figure every colour point in this group is set at.
 */
const APART_MIN = 40;

/** The band's bottom row, which is the board's floor (specs/board.md). */
const BAND_ROW = ROWS - 1;

/** The tile the cursor is posed on, and the tile the band is read off. */
const CURSOR_C = 20;
const BAND_C = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the cursor apart from the band it sits in", async () => {
  startPlaying(h);
  const where = tileBox(CURSOR_C, BAND_ROW);
  h.debug.setCursor(where.x, where.y);
  await h.advance(1);
  captureStill(h, "cursor");

  const cursor = h.snapshot().cursor;
  const apart = colorDistance(
    litColor(h, { x: cursor.x, y: cursor.y, half: where.half }),
    litColor(h, tileBox(BAND_C, BAND_ROW)),
  );
  assertGreaterThan(
    apart,
    APART_MIN,
    `the cursor, reported at (${cursor.x}, ${cursor.y}), against the band ` +
      `beside it on tile (${BAND_C}, ${BAND_ROW}), in RGB distance out of ` +
      "441 (specs/overview.md: the cursor reads apart from the player band it " +
      "sits in)",
  );
});
