// cursor/bolt-spawns-at-cursor — a fired bolt appears at the cursor's muzzle.
//
// specs/cursor.md: "A bolt is created with its center in the cursor's column, at
// the cursor's center `x`, and `CURSOR_HALF` (`12`) units above the cursor's
// center `y`."
//
// The column is read exactly, because the specification fixes it exactly: the
// bolt's centre `x` is the cursor's centre `x`, and "its center `x` never
// changes" while it flies. The height is read against a whole tile instead, and
// that looseness is deliberate: the bolt is created and then travels inside the
// same frame in some builds and in the next in others, and a frame at
// `BOLT_SPEED` (900) carries it 7.5 units at this suite's cadence. Twelve units
// of muzzle offset plus a frame of climb is well inside one `TILE` (32), which
// is the bound the review item states — and a bolt appearing anywhere else in
// the column (at the cursor, below it, a screen up) misses it.
//
// The bolt is FIRED, through the real registered fire action, rather than posed
// with `addBolt`: where a fired bolt appears is the whole of what this point
// decides. The cooldown is set to zero first so the frame the key is held for is
// one the cursor may fire on (specs/cursor.md), which is `cursor.fire-interval`'s
// requirement rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  holdActionFor,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far off the cursor's centre `x` the bolt's centre may sit, in logical
 * units. specs/cursor.md fixes it at the cursor's centre `x` exactly and states
 * that it never changes, so the only room is floating-point noise.
 */
const COLUMN_TOLERANCE = 1e-6;

/**
 * The most the bolt's centre may sit above the cursor's centre, in logical
 * units: one `TILE`, the bound the review item states. The specification's own
 * figure is `CURSOR_HALF` (12); the rest is the room a build that lets the bolt
 * travel on its first frame needs.
 */
const MUZZLE_MAX = TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the fired bolt in the cursor's column, just above it", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, BAND_CY);
  h.debug.setFireCooldown(0);

  await holdActionFor(h, "a", 1);
  captureStill(h, "muzzle");

  const after = h.snapshot();
  assertGreaterThanOrEqual(
    after.bolts.length,
    1,
    "a held fire action puts a bolt in flight",
  );
  const bolt = after.bolts[0];

  assertLessThanOrEqual(
    Math.abs(bolt.x - after.cursor.x),
    COLUMN_TOLERANCE,
    `the bolt is at x ${bolt.x}, the cursor at ${after.cursor.x}`,
  );
  assertGreaterThan(
    after.cursor.y - bolt.y,
    0,
    `the bolt is at y ${bolt.y}, the cursor at ${after.cursor.y}`,
  );
  assertLessThanOrEqual(
    after.cursor.y - bolt.y,
    MUZZLE_MAX,
    `the bolt is at y ${bolt.y}, the cursor at ${after.cursor.y}`,
  );
});
