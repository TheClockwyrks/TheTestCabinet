// progression/respawn-invulnerable — the cursor comes back with its spawn-in
// invulnerability running.
//
// THE RULE. `specs/progression.md`, *Losing a life*: *when that timer runs out,
// the phase becomes `active`, the cursor is given `RESPAWN_INVULN` (`2.0` s) of
// spawn-in invulnerability*. The grant is at the END of the respawn, not at the
// contact, so this check waits the whole `RESPAWN_TIME` (`1.4` s) out before it
// reads.
//
// THE COUNT IS READ AS A FIGURE, NOT AS A FLAG. `snapshot().cursor.invulnerable`
// is seconds remaining, so a build that grants some other span reads a different
// number and a build that grants none reads `0`. What the invulnerability DOES is
// `cursor.invulnerable-ignores-contact`; this point is only that the respawn hands
// it over, and hands over the span the specification names.
//
// The board is empty apart from the segment that took the life, and that segment
// is swept away by the loss itself, so nothing is standing in the cursor when it
// comes back and nothing can spend the grant before it is read.

import { afterEach, beforeEach, it } from "vitest";
import { RESPAWN_INVULN, RESPAWN_TIME, START_LIVES } from "../constants";
import { assertBetween } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseContact } from "./scenario";

/**
 * How far the reported grant may sit from `RESPAWN_INVULN` (`2.0` s), in seconds.
 *
 * The tolerance the point is stated with. It has to cover the settling frames
 * below, which is all the drive can cost: the grant lands as the respawn timer
 * runs out, and every frame taken after that counts against it at
 * `1 / TICK_HZ` seconds each — under 0.03 s in total, an order of magnitude
 * inside this bound.
 */
const INVULN_TOLERANCE = 0.2;

/** Frames the contact is given to resolve, before the respawn's own wait begins. */
const CONTACT_FRAMES = 1;

/**
 * Frames run past `RESPAWN_TIME` (`1.4` s), so the reading is taken with the
 * respawn certainly over rather than exactly on its last frame.
 */
const SETTLE_FRAMES = 2;

/** The whole respawn wait, in frames of the suite's clock. */
const RESPAWN_FRAMES = ticksFor(RESPAWN_TIME);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("hands the cursor RESPAWN_INVULN seconds of invulnerability", async () => {
  startPlaying(harness);
  harness.debug.setLives(START_LIVES);
  poseContact(harness);

  await harness.advance(CONTACT_FRAMES);
  await harness.advance(RESPAWN_FRAMES + SETTLE_FRAMES);

  captureStill(harness, "invulnerable");
  const remaining = harness.snapshot().cursor.invulnerable;
  assertBetween(
    remaining,
    RESPAWN_INVULN - INVULN_TOLERANCE,
    RESPAWN_INVULN + INVULN_TOLERANCE,
    `seconds left, ${seconds(SETTLE_FRAMES).toFixed(3)} s past the grant`,
  );
});
