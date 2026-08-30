// cursor/worm-contact-costs-life — a worm segment reaching the cursor costs one
// life.
//
// specs/cursor.md: "A worm segment or a foe reaching the cursor costs one life.
// The cursor's box is `CURSOR_HALF` (`12`) units from its center on each axis
// [...] A worm segment reaches the cursor when the segment's tile overlaps the
// cursor's box." specs/progression.md: on the contact, with lives to spare,
// "lives falls by one".
//
// THE GEOMETRY, WORKED OUT. The cursor is parked on the centre of tile (20, 19),
// which is (656, 704) — the floor row, inside the band on both axes — so its box
// spans x [644, 668] and y [692, 716]. Tile (20, 19) spans x [640, 672] and
// y [688, 720], which overlaps it; tile (19, 19) spans x [608, 640], which does
// not. A worm walking right along the floor row therefore reaches the cursor on
// the step that puts its head in column 20 and on no earlier one.
//
// The worm is a single segment, walking, on an otherwise empty board: no node
// stands in its way to turn it or take a charge, no other worm is in the roster
// to be counted, and the level's own spawners and worm entry are held off, so
// the only thing that can reach the cursor is the segment this poses.
//
// The reading is `lives` falling by exactly one from `START_LIVES` (3), which is
// "with lives to spare": a build that ended the run instead reads 0, one that
// charged two lives reads 1, and one that noticed nothing reads 3.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_Y_MAX, START_LIVES, tileCX } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The column the cursor is parked in, and the floor row both stand on. */
const CURSOR_COLUMN = 20;
const FLOOR_ROW = 19;

/** How far to the left of the cursor the worm's single segment starts. */
const APPROACH_COLUMNS = 2;

/**
 * How long the sweep waits for the contact, in frames.
 *
 * Two seconds, against a level-1 step interval of 0.14 s (specs/worm.md) that
 * puts the segment in the cursor's column on the second step: generous enough
 * that a build stepping slower than the specified interval still arrives, so
 * what is read is the contact and not the step clock.
 */
const SWEEP_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes one life when a walking segment reaches the parked cursor", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  h.debug.setCursorContact(true);
  h.debug.setCursor(tileCX(CURSOR_COLUMN), CURSOR_Y_MAX);
  poseWorm(h, CURSOR_COLUMN - APPROACH_COLUMNS, FLOOR_ROW, 1);

  let lives = h.snapshot().lives;
  for (let frame = 0; frame < SWEEP_TICKS; frame += 1) {
    await h.advance(1);
    const now = h.snapshot();
    lives = now.lives;
    if (lives !== START_LIVES) break;
    // The picture wanted is the last frame before the life was lost, and the
    // contact and the loss happen in one update: keep the frames the segment is
    // within a tile of the cursor, the newest of which is that one.
    const worm = now.worms[0];
    const head = worm === undefined ? undefined : headOf(worm);
    if (head !== undefined && Math.abs(head.c - CURSOR_COLUMN) <= 1) {
      captureStill(h, "contact");
    }
  }

  assertEqual(
    lives,
    START_LIVES - 1,
    "lives after a segment reached the cursor",
  );
});
