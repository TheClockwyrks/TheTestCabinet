// progression/respawn-clears-foes — a lost life sweeps every foe off the board.
//
// THE RULE. `specs/progression.md`, *Losing a life*, step 2: *every worm, every
// foe, and every bolt in flight is removed from the board*. This point is the foe
// roster; the worms are `progression/respawn-clears-worms`.
//
// THE CONTACT IS MADE BY A WORM SEGMENT, NOT BY THE FOE. What is being decided is
// that a foe standing somewhere else on the board is swept away with everything
// else, so the foe must not be the thing that ended the life: it stands high on
// the board, out of the cursor's reach, with its mind and its travel both off, so
// it neither moves nor acts and being swept is the only thing that can happen to
// it.
//
// The roster is read a small fraction of `RESPAWN_TIME` (`1.4` s) after the
// contact, inside the respawn window, and the level's own foe spawning stays off
// throughout — so an empty roster is a swept one and never a refilled one.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../../src/constants";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseFoe,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseContact } from "./scenario";

/** What the foe roster must hold once the life is lost: nothing at all. */
const SWEPT = 0;

/**
 * Where the bystander foe stands: high on the board and far from the cursor's
 * column, so it takes no part in the contact.
 */
const FOE_COL = 6;
const FOE_ROW = 4;

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

it("leaves no foe on the board after a life is lost", async () => {
  startPlaying(harness);
  harness.debug.setLives(START_LIVES);
  const foe = poseFoe(harness, "glitch", FOE_COL, FOE_ROW);
  harness.debug.setFoeMind(foe, false);
  harness.debug.setFoeTravel(foe, false);
  poseContact(harness);

  await harness.advance(CONTACT_FRAMES);

  captureStill(harness, "respawn");
  assertLength(harness.snapshot().foes, SWEPT);
});
