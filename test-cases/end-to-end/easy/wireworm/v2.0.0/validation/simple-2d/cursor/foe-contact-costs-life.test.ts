// cursor/foe-contact-costs-life — a foe reaching the cursor costs one life.
//
// specs/cursor.md: "A worm segment or a foe reaching the cursor costs one life ...
// A foe reaches the cursor when the foe's box, `FOE_HALF` (`12`) units from its
// center on each axis, overlaps the cursor's box", which is `CURSOR_HALF` (`12`)
// units from the cursor's centre on each axis.
//
// THE WORLD IS ONE GLITCH AND THE CURSOR. `startPlaying` empties the field and
// the three rosters and shuts the three world gates; this scenario turns back the
// one gate that IS the faculty being decided — `setCursorContact(true)` — and
// adds a single foe. `setFoeSpawning` stays off, so the glitch that arrives is
// the glitch this check put there.
//
// THE GLITCH IS POSED WITH ITS MIND OFF AND A VELOCITY ALONG THE ROW. The
// requirement is what a foe TOUCHING the cursor costs, so the only faculty the
// scenario needs from the foe is travel, and it needs that travel to end at the
// cursor. `setFoeMind(false)` stops the dart, which at `GLITCH_DART_INTERVAL`
// would otherwise reverse the glitch away from the cursor before it arrived —
// the dart is `foes.glitch-darts`'s requirement — and `setFoeVelocity(id,
// GLITCH_H_SPEED, 0)` takes the descent off the same reading, since a foe that
// sank as it crossed would be deciding `foes.glitch-descends` at the same time.
//
// THE GLITCH STARTS FOUR TILES OUT, so the reading is "a foe that ARRIVED costs a
// life" and not "a foe posed in contact costs one". The two boxes meet when their
// centres close to `CURSOR_HALF + FOE_HALF` (24) units, which from 128 units out
// is 104 units of travel.
//
// LIVES ARE POSED WITH SPARE, so the contact reads as a decrement rather than as
// the end of the run, which is `progression.game-over-at-zero-lives`'s point.
//
// WHAT THIS DOES NOT DECIDE. What losing a life does to the board belongs to the
// `progression` points. This point reads one number: the lives remaining.

import { afterEach, beforeEach, it } from "vitest";
import {
  CURSOR_HALF,
  FOE_HALF,
  GLITCH_H_SPEED,
  TILE,
  tileCX,
  tileCY,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseFoe,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The column the cursor is parked in, well clear of both side bounds. */
const CURSOR_C = 20;

/** The floor row, the bottom of the player band (specs/board.md). */
const FLOOR_R = 19;

/** How many tiles to the left of the cursor the glitch is posed. */
const APPROACH = 4;

/** Lives before the contact: the review item's "with lives to spare". */
const LIVES_BEFORE = 3;

/** Lives after it: specs/cursor.md costs exactly one. */
const LIVES_AFTER = LIVES_BEFORE - 1;

/** How close two centres must come for the boxes to overlap (specs/cursor.md). */
const TOUCHING = CURSOR_HALF + FOE_HALF;

/**
 * The drive, in frames of the harness's 120 Hz clock: 0.7 s.
 *
 * The glitch is posed `APPROACH` tiles out, which is 128 units, and the boxes
 * meet after 104 of them; at `GLITCH_H_SPEED` (210 units per second, the velocity
 * this scenario poses) that is 0.495 s. The drive runs 40% past it, so a build
 * that integrates the crossing a little differently still lands the contact
 * inside the window — the speed itself is not this point's requirement.
 */
const DRIVE_TICKS = ticksFor(0.7);

/**
 * How close the glitch's centre gets to the cursor's before the still is kept, in
 * logical units.
 *
 * Twice the overlap distance: the frame the glitch is bearing down on the cursor
 * and about to reach it. Kept before the contact, because the contact clears the
 * foe roster in the update it happens and there is nothing left to picture after.
 */
const CLOSING = 2 * TOUCHING;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes one life when a travelling glitch reaches the parked cursor", async () => {
  startPlaying(h);
  h.debug.setCursorContact(true);
  h.debug.setLives(LIVES_BEFORE);
  h.debug.setCursor(tileCX(CURSOR_C), tileCY(FLOOR_R));
  const foeId = poseFoe(h, "glitch", CURSOR_C - APPROACH, FLOOR_R);
  h.debug.setFoeMind(foeId, false);
  h.debug.setFoeVelocity(foeId, GLITCH_H_SPEED, 0);

  let captured = false;
  for (let frame = 0; frame < DRIVE_TICKS; frame += 1) {
    await h.advance(1);
    const board = h.snapshot();
    const foe = board.foes.find((held) => held.id === foeId);
    if (!captured && foe !== undefined && board.cursor.x - foe.x <= CLOSING) {
      captureStill(h, "contact");
      captured = true;
    }
  }

  assertEqual(
    h.snapshot().lives,
    LIVES_AFTER,
    `lives after a glitch travelled ${APPROACH * TILE} units along row ` +
      `${FLOOR_R} into the cursor parked on (${tileCX(CURSOR_C)}, ` +
      `${tileCY(FLOOR_R)}), from ${LIVES_BEFORE} over ${DRIVE_TICKS} frames ` +
      `(${seconds(DRIVE_TICKS)} s) — specs/cursor.md: a foe whose box comes ` +
      `within ${TOUCHING} units of the cursor's centre on each axis costs one ` +
      `life. ${LIVES_BEFORE} is a contact that never registered; ` +
      `${LIVES_BEFORE - 2} is one charged twice`,
  );
});
