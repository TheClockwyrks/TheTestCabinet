// cursor/bolt-spawns-at-cursor — a bolt is created at the cursor's muzzle.
//
// `specs/cursor.md`: "A bolt is created with its center in the cursor's column,
// at the cursor's center `x`, and `CURSOR_HALF` (`12`) units above the cursor's
// center `y`."
//
// THE WORLD IS THE CURSOR AND NOTHING ELSE. `startPlaying` leaves the board empty
// and the three world gates shut, so the only thing that can put a bolt in the
// roster is the fire action this check holds, and the only thing the bolt's
// reported position can be measured against is the cursor that fired it.
//
// THE CURSOR IS POSED ON A TILE CENTRE, so "in the cursor's column" is a reading
// and not a rounding: at `tileCX(20)` (656) the cursor's centre is 16 units from
// either edge of column 20, which is far more slack than any spec-honouring
// build's muzzle needs.
//
// THE DRIVE IS ONE FRAME. The review item allows the bolt to be up to a tile
// above the cursor's centre, which is what makes the reading indifferent to
// whether a build fires before or after it flies its bolts: a bolt that flew the
// frame it was fired is 9 units further up at `BOLT_SPEED` on the harness's 100
// Hz clock, and 12 + 9 is still inside one tile.
//
// WHAT THIS DOES NOT DECIDE. How often a held key fires is
// `cursor.fire-interval`'s requirement and how many bolts may be in flight is
// `cursor.bolt-cap`'s, so neither is read here — this point reads where the bolt
// the frame produced was put.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_CY, BOLT_SPEED, CURSOR_HALF, TILE, tileCX } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  lastBolt,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The key bound to `a` and `b`, the two fire actions (`specs/controls.md`). */
const FIRE_KEY = "Space";

/** The column the cursor is parked in, well clear of both side bounds. */
const CURSOR_C = 20;

/**
 * The largest gap the review item allows between the cursor's centre and the
 * bolt's, in logical units: "above its centre by no more than one tile".
 *
 * `specs/cursor.md` fixes the muzzle at `CURSOR_HALF` (12) units up. The item's
 * bound is `TILE` (32), which leaves room for a build that flies the bolt on the
 * frame it fires it — 12 plus one frame of `BOLT_SPEED` — and no room for a
 * build that spawned its bolts anywhere but at the cursor.
 */
const MUZZLE_MAX = TILE;

/** Bolts a build that fired at all has in the roster after the frame. */
const FIRED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("puts the fired bolt in the cursor's column, just above its centre", async () => {
  await startPlaying(h);
  await h.debug.setCursor(tileCX(CURSOR_C), BAND_CY);
  await h.debug.setFireCooldown(0);

  await h.holdFor(FIRE_KEY, 1);
  await captureStill(h, "muzzle");

  const posed = await h.snapshot();
  assertGreaterThanOrEqual(
    posed.bolts.length,
    FIRED,
    `bolts in flight after one frame of held ${FIRE_KEY} from a zero fire ` +
      "cooldown — specs/cursor.md: a bolt is fired whenever the cooldown is " +
      "at 0 and fewer than MAX_BOLTS bolts are in flight",
  );

  const bolt = lastBolt(posed);
  if (bolt === undefined) {
    fail(
      `a bolt in the roster after one frame of held ${FIRE_KEY} — ` +
        "specs/cursor.md",
      "the bolt roster was empty",
    );
  }

  assertEqual(
    Math.floor(bolt.x / TILE),
    CURSOR_C,
    `the column the fired bolt's centre x (${bolt.x}) stands in, against the ` +
      `cursor's column ${CURSOR_C} (centre x ${tileCX(CURSOR_C)}) — ` +
      "specs/cursor.md and specs/board.md",
  );

  const above = posed.cursor.y - bolt.y;
  assertGreaterThan(
    above,
    0,
    "how far the fired bolt's centre sits ABOVE the cursor's centre y " +
      `(${posed.cursor.y}) — specs/cursor.md puts the muzzle CURSOR_HALF ` +
      `(${CURSOR_HALF}) units up`,
  );
  assertLessThanOrEqual(
    above,
    MUZZLE_MAX,
    "how far the fired bolt's centre sits above the cursor's centre y, " +
      `against the one tile (${MUZZLE_MAX} units) the review item allows — a ` +
      `bolt flown on the frame it was fired is CURSOR_HALF plus ` +
      `${BOLT_SPEED / TICK_HZ} units up`,
  );
});
