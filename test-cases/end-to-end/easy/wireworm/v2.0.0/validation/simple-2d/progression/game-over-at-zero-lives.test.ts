// progression/game-over-at-zero-lives — the contact that takes the last life ends
// the run.
//
// THE RULE. `specs/progression.md`, *Losing a life*: *a contact that takes lives to
// `0` ends the run instead: the game moves to the `gameover` screen, reporting `0`
// lives*. It is the OTHER branch of the same contact `progression/life-lost-decrements`
// reads — one life left rather than lives to spare — so the two together say that a
// build takes the right branch at the boundary.
//
// THE COUNT IS POSED AT ONE, so the branch is reached by the game's own arithmetic
// rather than by posing zero and hoping. The screen and the count are one reading:
// a build that ends the run but leaves the last life on the HUD, and a build that
// empties the count but plays on, both differ from what the specification states.
//
// The world is the contact and nothing else: an empty, quiet board, and a single
// motionless worm segment standing in the cursor with the contact gate — this
// point's own requirement — turned back on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseContact } from "./scenario";

/** The last life: one more contact and the run is over. */
const LAST_LIFE = 1;

/** What the ended run must report. */
const NO_LIVES = 0;

/**
 * How long the contact is given to resolve, in frames. 0.05 s, which is a frame
 * for a build that answers inside the update the segment arrives in and a handful
 * more for one that settles it at the end of its own.
 */
const CONTACT_FRAMES = ticksFor(0.05);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("moves to the gameover screen with no lives left", async () => {
  startPlaying(harness);
  harness.debug.setLives(LAST_LIFE);
  poseContact(harness);

  await harness.advance(CONTACT_FRAMES);

  captureStill(harness, "gameover");
  const ended = harness.snapshot();
  assertEqual(ended.screen, "gameover", "screen");
  assertEqual(ended.lives, NO_LIVES, "lives");
});
