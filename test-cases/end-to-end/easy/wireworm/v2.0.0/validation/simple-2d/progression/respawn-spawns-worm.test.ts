// progression/respawn-spawns-worm — the level's worm enters afresh when the
// respawn runs out.
//
// THE RULE. `specs/progression.md`, *Losing a life*: *when that timer runs out,
// the phase becomes `active` ... and the level's worm enters afresh at the level's
// own length*. `specs/worm.md` fixes that length:
// `wormLength(level) = WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1)`.
//
// THE LEVEL IS POSED AWAY FROM 1 ON PURPOSE. At level 1 the length is
// `WORM_BASE_LENGTH` (`10`), which a build that always brings in a base-length
// worm would answer correctly by accident. At level 4 the level's length is `16`,
// so a build that enters the base length, or one that enters the length of some
// other level, reads a different number.
//
// WHAT IS READ IS WHAT ARRIVED, NOT WHAT LEFT. The reading is that a worm of the
// level's length is standing on the board once the respawn is over — not that it
// is the only worm there. Sweeping the old ones away is
// `progression/respawn-clears-worms`, and a build that fails to sweep should fail
// that point rather than this one as well.
//
// The worm-entry gate is the one gate this check turns back on, because the entry
// IS its requirement; the level's own foe spawning stays off, so the only thing
// that can arrive on this board is the worm the respawn brought.

import { afterEach, beforeEach, it } from "vitest";
import { RESPAWN_TIME, START_LIVES, wormLength } from "../constants";
import { assertContains } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseContact } from "./scenario";

/** The level the run is posed on: not level 1, so the length is a distinguishing figure. */
const LEVEL = 4;

/** Frames the contact is given to resolve, before the respawn's own wait begins. */
const CONTACT_FRAMES = 1;

/**
 * Frames run past `RESPAWN_TIME` (`1.4` s).
 *
 * Enough that the entry has certainly happened, and short enough that the fresh
 * worm has taken at most a step or two of the level's interval — which changes
 * where it stands, never how many segments it carries.
 */
const SETTLE_FRAMES = 4;

/** The whole respawn wait, in frames of the suite's clock. */
const RESPAWN_FRAMES = ticksFor(RESPAWN_TIME);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("brings in a worm of the level's own length", async () => {
  const { debug } = harness;
  startPlaying(harness);
  debug.setLives(START_LIVES);
  debug.setLevel(LEVEL);
  // The entry gate is this point's own requirement, so it goes back on.
  debug.setWormEntry(true);
  poseContact(harness);

  await harness.advance(CONTACT_FRAMES);
  await harness.advance(RESPAWN_FRAMES + SETTLE_FRAMES);

  captureStill(harness, "entered");
  const lengths = harness.snapshot().worms.map((worm) => worm.segments.length);
  assertContains(lengths, wormLength(LEVEL), "segment counts on the board");
});
