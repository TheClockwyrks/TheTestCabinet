// cursor/worm-contact-costs-life — a worm segment reaching the cursor costs one
// life.
//
// `specs/cursor.md`: "A worm segment or a foe reaching the cursor costs one
// life. The cursor's box is `CURSOR_HALF` (`12`) units from its center on each
// axis, and contact is an overlap of boxes ... A worm segment reaches the cursor
// when the segment's tile overlaps the cursor's box."
//
// THE WORLD IS ONE HEAD AND THE CURSOR. `startPlaying` empties the field and the
// three rosters and shuts the three world gates, and this scenario turns exactly
// one of them back on — `setCursorContact(true)`, which IS the faculty this
// point decides — and puts back a single-segment worm. A one-segment worm has no
// body to follow, so the only faculty running on it is the step that walks it
// into the cursor.
//
// THE FLOOR ROW IS WHERE THE TWO CAN MEET. `specs/board.md` confines the cursor
// to rows 18 and 19, so a segment reaching it has to be in the band; row 19 is a
// row a winding worm walks along (`specs/worm.md`: an unblocked head moves one
// tile horizontally and holds its row), and the row is clear, so the head walks
// straight down it into the parked cursor.
//
// THE HEAD STARTS TWO TILES OUT, WHICH IS ONE TILE MORE THAN CONTACT NEEDS. With
// the cursor parked on tile (20, 19)'s centre its box spans x in [644, 668];
// tile 19 ends at x = 640 and tile 20 begins there, so the head's first step
// lands it beside the cursor and its second lands it on top of it. The extra
// tile is what makes the reading "a segment that ARRIVED costs a life" rather
// than "a segment posed in contact costs a life".
//
// LIVES ARE POSED WITH SPARE. `setLives(3)` is the review item's "with lives to
// spare": at one life the contact would end the run instead, which is
// `progression.game-over-at-zero-lives`'s requirement, and the reading would be
// a screen change rather than a decrement.
//
// WHAT THIS DOES NOT DECIDE. What losing a life does to the board — the cleared
// rosters, the recentred cursor, the respawn phase — is `specs/progression.md`'s,
// and each part of it is one of the `progression` points. This point reads one
// number: the lives remaining.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_HALF, tileCX, tileCY, wormStepInterval } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWorm,
  segmentTiles,
  startPlaying,
  type Harness,
} from "../harness";

/** The column the cursor is parked in, well clear of both side bounds. */
const CURSOR_C = 20;

/** The floor row, the bottom of the player band (`specs/board.md`). */
const FLOOR_R = 19;

/** How many tiles to the left of the cursor the head is posed. */
const APPROACH = 2;

/** Lives before the contact: the review item's "with lives to spare". */
const LIVES_BEFORE = 3;

/** Lives after it: `specs/cursor.md` costs exactly one. */
const LIVES_AFTER = LIVES_BEFORE - 1;

/**
 * The drive, in frames of the harness's 100 Hz clock: three level-1 worm steps.
 *
 * `specs/worm.md` clocks the worm on `wormStepInterval(level)`, which is 0.14 s
 * at level 1, and the head needs two steps to reach the cursor's tile. The third
 * step is the margin, so a build whose step clock carries its remainder a frame
 * differently still lands the contact inside the window.
 */
const DRIVE_FRAMES = framesFor(3 * wormStepInterval(1));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes one life when a walking segment reaches the parked cursor", async () => {
  await startPlaying(h);
  await h.debug.setCursorContact(true);
  await h.debug.setLives(LIVES_BEFORE);
  await h.debug.setCursor(tileCX(CURSOR_C), tileCY(FLOOR_R));
  await poseWorm(h, { c: CURSOR_C - APPROACH, r: FLOOR_R, length: 1, dh: 1 });

  // The still is taken the first frame the head stands on the tile beside the
  // cursor, because the contact itself empties the board in the update it
  // happens: the frame that shows the segment closing on the cursor is the last
  // one there is to show.
  let captured = false;
  for (let frame = 0; frame < DRIVE_FRAMES; frame += 1) {
    await h.advance(1);
    if (captured) continue;
    const beside = segmentTiles(await h.snapshot()).some(
      (tile) => tile.c === CURSOR_C - 1 && tile.r === FLOOR_R,
    );
    if (beside) {
      await captureStill(h, "contact");
      captured = true;
    }
  }

  assertEqual(
    (await h.snapshot()).lives,
    LIVES_AFTER,
    `lives after a worm walked row ${FLOOR_R} into the cursor parked on ` +
      `(${tileCX(CURSOR_C)}, ${tileCY(FLOOR_R)}), from ${LIVES_BEFORE} — ` +
      "specs/cursor.md: a segment whose tile overlaps the cursor's box " +
      `(CURSOR_HALF ${CURSOR_HALF} on each axis) costs one life. ` +
      `${LIVES_BEFORE} is a contact that never registered; ` +
      `${LIVES_BEFORE - 2} is one charged twice`,
  );
});
