// progression/respawn-centres-cursor — a lost life puts the cursor back at the
// band's center.
//
// `specs/progression.md`, Losing a life, step 3: "The cursor is placed at the
// band's center, `(640, 688)`." The figure is stated outright, and
// `specs/cursor.md`'s four bounds put that point exactly halfway along the band
// on both axes.
//
// So the cursor is posed AWAY from it first — hard into the bottom-left corner
// of the band, on `CURSOR_X_MIN` and `CURSOR_Y_MAX` — and the segment that costs
// the life is laid on the tile the cursor is standing in there. A build that
// re-centers the cursor answers with the band's center; one that leaves the
// cursor where the contact caught it answers `(16, 704)`, a whole board away;
// one that re-centers on one axis only answers with the two mixed.
//
// TOLERANCE. `specs/progression.md` names the point exactly, but a build is free
// to arrive at it from `specs/cursor.md`'s bounds rather than from the literal
// pair, so the reading allows one tile of slack on each axis — `TILE` (`32`),
// the coarsest unit the board is built out of, and far tighter than the distance
// to any wrong answer above.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  colAt,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  rowAt,
  TILE,
} from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { contactCursor } from "./run";

/** Where the cursor is caught: hard into the band's bottom-left corner. */
const CAUGHT_AT = { x: CURSOR_X_MIN, y: CURSOR_Y_MAX };

/**
 * The tile the segment stands on to reach it there.
 *
 * The cursor's box is `CURSOR_HALF` (`12`) units from its center on each axis
 * (`specs/cursor.md`), and at the corner that whole box lies inside this one
 * tile, so the overlap the contact rule asks for is unambiguous.
 */
const CAUGHT_TILE = { c: colAt(CAUGHT_AT.x), r: rowAt(CAUGHT_AT.y) };

/** One tile of slack on each axis, as the point states. */
const SLACK = TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns the cursor to the band's center", async () => {
  await startPlaying(h);
  await h.debug.setCursor(CAUGHT_AT.x, CAUGHT_AT.y);

  await contactCursor(h, CAUGHT_TILE);

  await captureStill(h, "centred");
  const after = await h.snapshot();
  assertEqual(
    after.phase,
    "respawn",
    "precondition: the contact opened the respawn (specs/progression.md)",
  );
  assertBetween(
    after.cursor.x,
    BAND_CX - SLACK,
    BAND_CX + SLACK,
    "the cursor's center x after the respawn placed it",
  );
  assertBetween(
    after.cursor.y,
    BAND_CY - SLACK,
    BAND_CY + SLACK,
    "the cursor's center y after the respawn placed it",
  );
});
