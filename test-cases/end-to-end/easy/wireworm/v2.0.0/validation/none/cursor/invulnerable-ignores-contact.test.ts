// cursor/invulnerable-ignores-contact — a contact costs nothing while the
// cursor's spawn-in invulnerability is still running.
//
// `specs/cursor.md`: "While the cursor's spawn-in invulnerability is still
// running, a contact costs no life and nothing is removed by it, so the cursor
// plays on through whatever it is standing in."
//
// THIS IS `cursor.worm-contact-costs-life`'S SCENARIO WITH ONE FIELD CHANGED,
// and that is deliberate: the two points differ by `setCursorInvulnerable`
// alone, so what separates a pass here from a pass there is the faculty being
// decided and nothing else about the world. The contact gate is ON — with it off
// no contact would cost anything and this point would pass on a build with no
// invulnerability at all.
//
// THE CONTACT IS WITNESSED, NOT ASSUMED. "Costs no life" is a reading a build
// could satisfy by never letting the segment reach the cursor, so the drive
// records whether a segment ever stood on the cursor's own tile and fails if
// none did. Without that, a build whose worm never stepped would read as a build
// whose invulnerability worked.
//
// THE LIVES READING COMES FIRST, AND THE WITNESS SECOND. A build that charged
// for the contact clears the board in the update it happened, so the segment
// never gets to be seen standing on the cursor — and the witness, read first,
// would report "nothing reached the cursor" for a defect that is really "the
// life was taken". Read in this order the direct number is what a failure names,
// and the witness still refuses the vacuous pass it exists to refuse: a build
// whose worm never stepped keeps its lives and is caught by it.
//
// THE INVULNERABILITY OUTLASTS THE DRIVE BY A WIDE MARGIN.
// `specs/instrumentation.md` makes `setCursorInvulnerable` seconds remaining,
// counted down against each update's delta; two seconds against a 0.42 s drive
// means the window cannot expire mid-scenario and turn this into a life-loss
// check.
//
// WHAT THIS DOES NOT DECIDE. How much invulnerability a respawn grants is
// `progression.respawn-invulnerable`'s requirement, so no figure of the game's
// is read here — the pose is this check's own, chosen to outlast its own drive.

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY, wormStepInterval } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWorm,
  seconds,
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

/**
 * The drive, in frames of the harness's 100 Hz clock: three level-1 worm steps.
 *
 * The head needs two steps of `wormStepInterval(1)` (0.14 s) to reach the
 * cursor's tile; the third is the margin.
 */
const DRIVE_FRAMES = framesFor(3 * wormStepInterval(1));

/**
 * Seconds of invulnerability posed on the cursor.
 *
 * Comfortably longer than the drive, so the window is still running at every
 * frame of it and a build that counts it down correctly cannot lose it
 * mid-scenario.
 */
const INVULNERABLE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("costs no life when a segment reaches a cursor that is still invulnerable", async () => {
  await startPlaying(h);
  await h.debug.setCursorContact(true);
  await h.debug.setCursorInvulnerable(INVULNERABLE);
  await h.debug.setLives(LIVES_BEFORE);
  await h.debug.setCursor(tileCX(CURSOR_C), tileCY(FLOOR_R));
  await poseWorm(h, { c: CURSOR_C - APPROACH, r: FLOOR_R, length: 1, dh: 1 });

  let reached = false;
  for (let frame = 0; frame < DRIVE_FRAMES; frame += 1) {
    await h.advance(1);
    if (reached) continue;
    const onCursor = segmentTiles(await h.snapshot()).some(
      (tile) => tile.c === CURSOR_C && tile.r === FLOOR_R,
    );
    if (onCursor) {
      // The segment standing ON the cursor's tile with the run still going is
      // the whole of what this point looks like, so that is the frame kept.
      await captureStill(h, "absorbed");
      reached = true;
    }
  }

  assertEqual(
    (await h.snapshot()).lives,
    LIVES_BEFORE,
    `lives after a worm segment reached a cursor with ${INVULNERABLE} s of ` +
      "spawn-in invulnerability left — specs/cursor.md: while it is running, " +
      `a contact costs no life. ${LIVES_BEFORE - 1} is a build that charged ` +
      "for the contact anyway",
  );

  assertTrue(
    reached,
    "whether a worm segment ever stood on the cursor's own tile " +
      `(${CURSOR_C}, ${FLOOR_R}) inside ${DRIVE_FRAMES} frames ` +
      `(${seconds(DRIVE_FRAMES)} s) — specs/cursor.md has the cursor "play ` +
      'on through whatever it is standing in" while invulnerable, so a drive ' +
      "in which nothing ever reached it decides nothing",
  );
});
