// Wireworm — instrumentation/cursor-contact-gate: with the cursor's contact test
// gated off, a worm segment standing in the cursor's tile costs nothing; with it
// on, the same scenario costs a life.
//
// specs/instrumentation.md gives the gate exactly one faculty:
// `setCursorContact(enabled)` gates "The cursor's contact test, which is whether
// a worm segment or a foe reaching the cursor costs a life. Off, the cursor
// still draws, still moves under input, and still fires, and no contact costs
// anything." specs/cursor.md fixes the contact it gates: a worm segment reaches
// the cursor when the segment's tile overlaps the cursor's box, which is
// `CURSOR_HALF` (`12`) units from its centre on each axis.
//
// THE CURSOR IS THE ONE ENTITY A SCENARIO CANNOT REMOVE. `startPlaying` parks it
// at the band's centre, and the band is rows `18` and `19` — which is where a
// worm blocked on the floor oscillates, where a dive ends, and where any foe
// advanced far enough descends to. Without this gate a contact there would take
// a life, and specs/progression.md answers a lost life by sweeping every worm,
// every foe and every bolt off the board: a scenario emptied mid-run, reporting
// a defect that belongs to another point. So the points that run anything near
// the band rest on this gate, and this point is where it is decided.
//
// THE SCENARIO IS DRIVEN ONTO THE CURSOR, NOT POSED ONTO IT. A worm is posed two
// tiles to the left of the cursor's tile on the floor row and left to wind
// right, and the check waits for the step that puts a segment ON that tile —
// which it reads back off the snapshot rather than assuming. So neither half
// rests on a step count: a build whose worm is slower simply arrives later
// inside the window, and one whose worm never arrives fails naming that.
//
// AND THE SAME SCENARIO IS RUN TWICE. Gated off, the lives and the phase are
// held to being exactly what they were with a segment standing in the cursor's
// tile; gated on, the same drive is held to costing a life. Without the second
// half a build whose contact test never fires would pass a point about holding
// it off.
//
// WHAT THIS DOES NOT DECIDE. What a lost life DOES — the sweep, the respawn
// pause, the invulnerability that follows it — which is
// `progression/life-lost-decrements` and its siblings; nor the shape of the
// cursor's box, which is `cursor/worm-contact-costs-life`'s. The one reading
// here is whether the contact test ran at all.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, tileCX, tileCY, WORM_STEP_L1 } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWorm,
  startPlaying,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/**
 * The tile the cursor's centre is placed on: the floor row, in the middle of the
 * board. Its centre is `(656, 704)`, which is inside the band's bounds
 * (specs/board.md), so the clamp has nothing to do here.
 */
const CURSOR_C = 20;
const CURSOR_R = 19;

/**
 * Where the worm's head starts: two tiles to the left, on the same row, heading
 * right. Two tiles of clear floor, so the head reaches the cursor's tile on its
 * second step and the tile it starts on is well clear of the cursor's box.
 */
const WORM_C = CURSOR_C - 2;

/**
 * How long each half is given for a segment to reach the cursor's tile, in
 * seconds.
 *
 * `1.4` s is ten `WORM_STEP_L1`s (`0.14` s at level 1, specs/worm.md) for two
 * tiles of travel, so a build whose worm is five times slower than the figure
 * still arrives inside it. Nothing here reads how long it took.
 */
const REACH_SECONDS = 10 * WORM_STEP_L1;

/** Frames left to run once a segment is standing in the cursor's tile. */
const SETTLE_FRAMES = 3;

/** Whether any worm has a segment on the cursor's tile. */
function segmentOnCursorTile(snapshot: WirewormSnapshot): boolean {
  return snapshot.worms.some((worm) =>
    worm.segments.some(
      (segment) => segment.c === CURSOR_C && segment.r === CURSOR_R,
    ),
  );
}

/** Pose the cursor on its tile with a worm two tiles away, heading into it. */
async function poseTheApproach(h: Harness): Promise<void> {
  await startPlaying(h);
  await h.debug.setCursor(tileCX(CURSOR_C), tileCY(CURSOR_R));
  await h.debug.setCursorInvulnerable(0);
  await h.debug.setLives(START_LIVES);
  await poseWorm(h, { c: WORM_C, r: CURSOR_R });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("costs no life while the contact test is gated off, and one while it is on", async () => {
  // ---- Gated off ----------------------------------------------------------

  await poseTheApproach(h);
  await h.debug.setCursorContact(false);

  const reached = await h.until(segmentOnCursorTile, {
    maxFrames: framesFor(REACH_SECONDS),
  });
  // Before the assertions, so a failing gate still leaves the picture of the
  // segment standing in the cursor's tile.
  await captureStill(h, "gated");
  assertTrue(
    reached.hit,
    `a worm segment to stand on the cursor's tile (${CURSOR_C}, ` +
      `${CURSOR_R}) within ${REACH_SECONDS.toFixed(2)} s of being posed two ` +
      `tiles away heading into it — without the contact, neither half of ` +
      `this point reads anything`,
  );

  await h.advance(SETTLE_FRAMES);
  const held = await h.snapshot();
  assertEqual(
    held.lives,
    START_LIVES,
    `the lives left with a worm segment standing in the cursor's tile and ` +
      `setCursorContact(false) held`,
  );
  assertEqual(
    held.phase,
    "active",
    `the phase with that same segment standing there — a contact answers with ` +
      `the respawn phase (specs/progression.md), and the gate holds the ` +
      `contact test off`,
  );

  // ---- Gated on, on the same scenario --------------------------------------

  await poseTheApproach(h);
  await h.debug.setCursorContact(true);

  const cost = await h.until((s) => s.lives < START_LIVES, {
    maxFrames: framesFor(REACH_SECONDS),
  });
  assertTrue(
    cost.hit,
    `a life to be lost within ${REACH_SECONDS.toFixed(2)} s of the same worm ` +
      `being posed two tiles from the cursor with setCursorContact(true) — ` +
      `without it, an unchanged life count while the gate was off says ` +
      `nothing about the gate`,
  );
  assertEqual(
    cost.snapshot.lives,
    START_LIVES - 1,
    `the lives left after that contact, from the ${START_LIVES} the scenario ` +
      `was posed with`,
  );
});
