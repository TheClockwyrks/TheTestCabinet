// progression/respawn-centres-cursor — a lost life puts the cursor back at the
// band's center.
//
// specs/progression.md, Losing a life: on a contact with lives to spare, the
// cursor is placed at the band's center, `(640, 688)` — which is the midpoint of
// the band's four bounds, `CURSOR_X_MIN`/`CURSOR_X_MAX` and
// `CURSOR_Y_MIN`/`CURSOR_Y_MAX` (specs/cursor.md), and is what the harness's
// `BAND_CX`/`BAND_CY` are derived from.
//
// THE CONTACT IS POSED FAR FROM THE CENTER, DELIBERATELY. `startPlaying` already
// parks the cursor at the band's center, so a contact posed on the cursor where
// it stands would be answered correctly by a build that never moved it at all.
// The contact is therefore posed near the LEFT of the board, a good third of the
// stage away, so only a build that actually re-placed the cursor reads back a
// center.
//
// Only the placement is read. The lives, the swept rosters and the
// invulnerability are each their own point.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, TILE } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { CONTACT_R, poseContact } from "./contact";

/**
 * The column the contact is posed in: far to the left of the band's center,
 * whose column is `20`. Tile `5`'s center is `x = 176`, so the cursor starts
 * `464` units from where it must end up — fourteen times the tolerance below.
 */
const FAR_C = 5;

/**
 * How far from the band's center the cursor may be found, in logical units.
 *
 * One tile, `TILE` (`32`, specs/board.md). specs/progression.md names the exact
 * point `(640, 688)`, so a build placing the cursor there is dead on; the tile
 * of slack is there so a build that carries its cursor in tile-ish terms, or
 * rounds the band's midpoint, is not failed for a rounding — while a build that
 * left the cursor where the contact happened is `464` units out and fails.
 */
const CENTER_TOLERANCE = TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the cursor back at the band's center", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  poseContact(h, FAR_C, CONTACT_R);

  await h.advance(1);
  captureStill(h, "centred");

  const { cursor } = h.snapshot();
  const offset = Math.hypot(cursor.x - BAND_CX, cursor.y - BAND_CY);
  assertLessThanOrEqual(
    offset,
    CENTER_TOLERANCE,
    `the cursor's distance from the band's center (${BAND_CX}, ${BAND_CY})`,
  );
});
