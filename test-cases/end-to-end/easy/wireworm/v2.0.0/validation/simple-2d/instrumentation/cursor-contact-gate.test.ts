// Wireworm — instrumentation/cursor-contact-gate: `setCursorContact(false)` costs
// no life, and turning it back on costs one.
//
// specs/instrumentation.md: "The cursor's contact test, which is whether a worm
// segment or a foe reaching the cursor costs a life. Off, the cursor still draws,
// still moves under input, and still fires, and no contact costs anything."
// specs/cursor.md is what the gate suspends: a worm segment reaches the cursor
// when the segment's tile overlaps the cursor's box, `CURSOR_HALF` (`12`) units
// from its center on each axis.
//
// WHY THE SUITE RESTS ON IT. The cursor is the one entity no scenario can remove —
// `startPlaying` parks it in the middle of its band — so its contact test reaches
// into every scenario staged near the floor and every one advanced far enough for
// a foe to descend, and specs/progression.md empties the worm, foe and bolt
// rosters the moment a life is lost. Without this gate those scenarios lose the
// board they were posed on partway through. So the gate is proved here before
// anything leans on it.
//
// THE SEGMENT IS POSED IN THE CURSOR'S TILE RATHER THAN STEPPED INTO IT, and its
// step is gated off. specs/cursor.md decides a contact from an OVERLAP of boxes
// and says nothing about motion, so a still segment standing in the cursor is
// exactly the situation the rule is written about — and posing it there means a
// build whose worm steps crookedly fails `worm.winds-horizontal` rather than this
// point. Anything else about the board would only add ways for this point to fail
// for another point's reason.
//
// THE CURSOR IS PARKED ON A TILE'S CENTER, `(656, 688)`, so its `24`-unit box lies
// inside that tile's `32` units horizontally and overlaps no neighbouring column.
// The posed segment is the only thing that can touch it.
//
// THE SPAWN-IN INVULNERABILITY IS ZERO, which `startPlaying` poses: while it runs,
// specs/cursor.md costs no life whatever the cursor is standing in, and that rule
// is `cursor.invulnerable-ignores-contact`'s point rather than this one's.
//
// The two directions are two checks, so a build that never costs a life and a
// build that ignores the gate grade differently.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, tileCX, tileCY } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The tile the cursor is parked on and the segment is posed on: the floor row,
 * inside the player band specs/board.md gives rows `18` and `19`, and far from
 * either side edge.
 */
const TILE_C = 20;
const TILE_R = 19;

/**
 * Frames the contact test is given to run.
 *
 * specs/cursor.md tests the overlap as part of each update, so one frame is
 * enough; a tenth of a second is a dozen of them, and a build that tests the
 * overlap anywhere in its frame has had every chance.
 */
const CONTACT_TICKS = ticksFor(0.1);

/** Pose the cursor with a worm segment standing in its tile. */
function poseContact(h: Harness): void {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  h.debug.setCursor(tileCX(TILE_C), tileCY(TILE_R));
  const id = poseWorm(h, TILE_C, TILE_R);
  // Held still: the requirement is the overlap, not a step into it.
  h.debug.setWormStepping(id, false);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life with the contact test off", async () => {
  poseContact(h);
  assertEqual(
    h.snapshot().cursor.contact,
    false,
    "startPlaying opens with the cursor's contact test gated off",
  );

  await h.advance(CONTACT_TICKS);
  // The segment standing in the cursor's tile.
  captureStill(h, "gated");

  const after = h.snapshot();
  assertEqual(
    after.lives,
    START_LIVES,
    "a segment standing in the cursor costs no life with " +
      "setCursorContact(false) (specs/instrumentation.md)",
  );
  assertEqual(
    after.phase,
    "active",
    "and the phase is still active: no respawn was triggered " +
      "(specs/progression.md)",
  );
  assertLength(
    after.worms,
    1,
    "and the board is as it was posed: nothing was swept off it",
  );
});

it("costs a life with the contact test on", async () => {
  poseContact(h);
  h.debug.setCursorContact(true);

  await h.advance(CONTACT_TICKS);

  const after = h.snapshot();
  assertEqual(
    after.lives,
    START_LIVES - 1,
    "the same segment costs one life with setCursorContact(true) " +
      "(specs/cursor.md)",
  );
});
