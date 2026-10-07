// progression/respawn-clears-worms — a lost life sweeps every worm off the board.
//
// THE RULE. `specs/progression.md`, *Losing a life*, step 2: *every worm, every
// foe, and every bolt in flight is removed from the board*. This point is the
// worms alone; the foes are `progression/respawn-clears-foes`.
//
// TWO WORMS ARE POSED, NOT ONE. The requirement is EVERY worm, so a board holding
// only the segment that caused the contact could not tell a build that sweeps the
// roster apart from one that removes just the worm it collided with. The second
// worm stands well away from the band and is motionless — both faculties off —
// so it does nothing but wait to be swept, and its removal is the only thing it
// can report.
//
// The roster is read DURING the respawn: the reading is taken a small fraction of
// `RESPAWN_TIME` (`1.4` s) after the contact, long before the phase could give way
// and bring a fresh worm in — and the worm-entry gate is off in any case, so
// nothing can arrive to confuse an empty roster with a refilled one.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../constants";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseContact, poseStillWorm } from "./scenario";

/** What the worm roster must hold once the life is lost: nothing at all. */
const SWEPT = 0;

/**
 * Where the bystander worm stands: high on the board and far from the cursor's
 * column, so it takes no part in the contact and nothing but the sweep can reach
 * it.
 */
const BYSTANDER_COL = 5;
const BYSTANDER_ROW = 5;

/** How many segments it carries — enough that a partial sweep would leave a trace. */
const BYSTANDER_LENGTH = 4;

/**
 * How long the contact is given to resolve, in frames. A thirtieth of
 * `RESPAWN_TIME` (`1.4` s), so the reading lands inside the respawn window.
 */
const CONTACT_FRAMES = ticksFor(0.05);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves no worm on the board after a life is lost", async () => {
  startPlaying(harness);
  harness.debug.setLives(START_LIVES);
  poseStillWorm(harness, BYSTANDER_COL, BYSTANDER_ROW, BYSTANDER_LENGTH);
  poseContact(harness);

  await harness.advance(CONTACT_FRAMES);

  captureStill(harness, "respawn");
  assertLength(harness.snapshot().worms, SWEPT);
});
