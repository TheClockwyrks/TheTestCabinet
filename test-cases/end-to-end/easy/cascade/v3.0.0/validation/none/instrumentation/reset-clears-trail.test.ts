// instrumentation/reset-clears-trail — `reset()` clears the painted layer itself,
// not merely the count of what is on it: a table a cascade buried comes back bare.
//
// THE RULE. `specs/instrumentation.md`, The core: `reset` "clears the painted
// layer and sets `trailStamps` to `0`". Two things, and this point reads both — the
// count from the snapshot, and the layer from the pixels of the table.
//
// WHY THE PIXELS ARE THE POINT. `instrumentation/reset-restores-title` already
// reads `trailStamps` back as one of the eighteen fields `reset` restores, so a
// build that zeroes the counter passes there. What no snapshot field can say is
// whether the SURFACE was cleared, and a persistent full-stage layer is exactly
// the kind of thing a build forgets to wipe: the game would then open its next
// deal on a felt still buried under the last one's cards. So the table is read as
// pixels, before the paint and after the reset, and the counter reading rides
// along because the specification names it in the same clause.
//
// A REAL CASCADE PAINTS IT. `startCascade` wins the game through its own win
// path, so what stamps the layer is the build's own cascade rather than a posed
// flyer, and `trailStamps` rises because "no operation sets it" — it counts the
// stamps flight left (`specs/instrumentation.md`).
//
// THE TABLE IS COMPARED AGAINST ITS OWN EARLIER SELF, twice over the same grid.
// The specification fixes no colour and no felt, so there is no absolute reading
// to take: what is asserted is that a point differs from the bare table before the
// reset and does not differ after it. The two readings are taken in states that
// are identical in every field a frame could draw from — an empty table on the
// `won` screen, no card in flight, nothing launched, and one frame of game time
// accumulated in each — so a build that animates its felt matches itself.
//
// AND EVERYTHING BUT THE LAYER IS CLEARED AWAY BEFORE THE FIRST READING IS TAKEN.
// Mid-cascade the frame also carries cards in flight and the cards still sitting
// on the foundations, and a difference from bare felt could then be either. So the
// launching is stopped, the flight is emptied and the thirteen piles are cleared —
// all three of which "leave the painted layer alone" (`specs/instrumentation.md`)
// — and what is left over the felt is the paint and nothing else.
//
// THE SCREEN IS POSED BACK AFTER THE RESET, because `reset` returns the game to
// `title` and the layer is drawn on the table beneath the cascade
// (`specs/victory.md`). `setScreen` "changes no other field", so it cannot put
// back a layer the reset cleared.
//
// WHAT THIS DOES NOT DECIDE. That a stamp is laid at all, or persists, or
// accumulates — `cascade/trail-persists` and `cascade/trail-accumulates` — nor
// that `clearTrail` clears the layer, which is `instrumentation/clear-trail`'s,
// nor that a new deal does, which `specs/deal.md` requires and `deal/*` grades.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { CARD_H, CARD_W } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  gridPoints,
  openTable,
  startCascade,
  STAGE_RECT,
  type Harness,
} from "../harness";

/** How much of the real cascade is run, in seconds of game time. */
const PAINT_SECONDS = 1;

/**
 * The grid the whole table is read on: `32 x 18` points at the stage's own
 * aspect, one every `40` logical units in both directions.
 *
 * A stamp is a whole card (`100 x 140`), so whatever offset one falls at it
 * covers at least two of these columns and three of these rows. The grid can
 * therefore neither miss a stamp that is there nor invent one that is not, and it
 * is read in one crossing into the page.
 */
const SAMPLE_COLS = 32;
const SAMPLE_ROWS = 18;
const POINTS = gridPoints(STAGE_RECT, SAMPLE_COLS, SAMPLE_ROWS);

/** The grid's pitch, which the comment above rests on. Not a tolerance. */
const PITCH_X = STAGE_RECT.w / SAMPLE_COLS;
const PITCH_Y = STAGE_RECT.h / SAMPLE_ROWS;

/*
 * A point counts as painted when it reads DIFFERENTLY from the same point on the
 * bare table, and how far apart the two sit is not measured: `specs/overview.md`
 * fixes no palette, so that is the reviewer's. Rendering is deterministic and each
 * point is compared against itself, so any difference at all is the paint.
 */

/**
 * How many painted points the cascade must have left, before the reset.
 *
 * Six — one card's worth, since a single stamp covers at least `2 x 3` of the
 * grid above. It is a precondition and not a measurement: the specification fixes
 * no coverage and could not, because what a cascade covers depends on launch
 * velocities it deliberately leaves random. All this rules out is a build that
 * painted nothing, which would pass a reading of a cleared table for the wrong
 * reason.
 */
const MIN_PAINTED_POINTS = 6;

/**
 * The largest colour distance a CLEARED point may show against the same point
 * read before anything was painted, out of `441`.
 *
 * `8`. Both readings are the same build drawing states the specification makes
 * identical, so the only distance between them is the rasterizer's own; this is
 * that noise floor with room to spare, and a stamp of a whole card cannot hide
 * inside it.
 */
const CLEAN_DISTANCE = 8;

/** The colour distance between two sampled pixels. */
function distance(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the painted layer and returns trailStamps to 0", async () => {
  if (PITCH_X > CARD_W / 2 || PITCH_Y > CARD_H / 2) {
    throw new RangeError(
      `cascade: a ${SAMPLE_COLS} x ${SAMPLE_ROWS} grid has a pitch of ` +
        `${PITCH_X} x ${PITCH_Y}, too coarse to be sure of catching a ` +
        `${CARD_W} x ${CARD_H} stamp`,
    );
  }

  // ---- The bare table -------------------------------------------------------

  await openTable(h);
  // The screen the cascade runs on (`specs/screens.md`), with nothing on the
  // table under it, and one frame of game time behind it — which is exactly the
  // state the second reading is taken in.
  await h.debug.setScreen("won");
  await h.advance(1);
  const bare = await h.pixels(POINTS);

  // ---- A cascade, and the table it buries -----------------------------------

  // Back to the table to win on: `specs/victory.md` stops play on the `won`
  // screen, so the move that wins the game is made on `playing` and the win
  // itself is what moves the screen.
  await h.debug.setScreen("playing");
  await startCascade(h);
  await h.advance(framesFor(PAINT_SECONDS));

  // Everything but the layer taken off the frame: no card launching, none in
  // flight, and none on a pile. All three leave the painted layer alone
  // (`specs/instrumentation.md`), so what is left over the felt is the paint.
  await h.debug.setLaunching(false);
  await h.debug.clearFlyers();
  await h.debug.clearTable();
  await h.advance(1);
  const buried = await h.snapshot();
  const painted = (await h.pixels(POINTS)).filter(
    (pixel, index) => distance(pixel, bare[index]) > 0,
  ).length;

  // ---- The reset ------------------------------------------------------------

  await h.debug.reset();
  // Read with no frame between, so the count is the reset's own work rather than
  // the frame after it.
  const cleared = await h.snapshot();

  // `reset` returns the game to `title`; the layer is drawn on the table, so the
  // table is where it has to be looked for. `setScreen` changes no other field.
  await h.debug.setScreen("won");
  await h.advance(1);
  // Before the assertions, so a layer that was not cleared still leaves the
  // picture of the table the reset returned to.
  await captureStill(h, "cleared");
  const after = await h.pixels(POINTS);

  // ---- The readings ---------------------------------------------------------

  assertGreaterThan(
    buried.trailStamps,
    0,
    `snapshot().trailStamps after ${PAINT_SECONDS} s of the game's own ` +
      `victory cascade — a cascade that stamped nothing would leave nothing ` +
      `for the reset to clear`,
  );
  assertGreaterThanOrEqual(
    painted,
    MIN_PAINTED_POINTS,
    `the sampled points of the table reading differently from the bare felt ` +
      `after that cascade, of ${POINTS.length} read — the layer has to have ` +
      `been painted for a reading of a cleared one to mean anything`,
  );

  assertEqual(
    cleared.trailStamps,
    0,
    "snapshot().trailStamps after reset(), which clears the painted layer and " +
      "sets it to 0 (specs/instrumentation.md)",
  );
  assertLessThanOrEqual(
    Math.max(...after.map((pixel, index) => distance(pixel, bare[index]))),
    CLEAN_DISTANCE,
    `the largest colour distance across ${POINTS.length} points of the table ` +
      `after reset(), against the same points read before anything was ` +
      `painted — reset clears the painted layer itself, not only the count of ` +
      `what is on it (specs/instrumentation.md), and ${painted} of these ` +
      `points were painted a moment before it`,
  );
});
