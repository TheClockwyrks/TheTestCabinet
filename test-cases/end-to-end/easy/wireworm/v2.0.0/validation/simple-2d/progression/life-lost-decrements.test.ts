// progression/life-lost-decrements — a contact with lives to spare costs exactly
// one life.
//
// THE RULE. `specs/progression.md`, *Losing a life*: on a contact, with lives to
// spare, *lives falls by one*. `specs/cursor.md` states what a contact is — a worm
// segment reaching the cursor, which is the segment's tile overlapping the
// cursor's box.
//
// THE WORLD IS EXACTLY THE CONTACT AND NOTHING ELSE. `startPlaying` opens an empty,
// quiet board; the one entity added is a single worm segment standing in the
// cursor, and both of its faculties are off, so it neither steps nor follows and
// the only rule left that can act is the contact test. The cursor's contact gate
// is the one gate this check turns back on, because the contact IS its
// requirement.
//
// THE COUNT IS READ AS AN EXACT FIGURE, NOT A DIRECTION: a build that spends two
// lives on one contact, or that empties the count outright, reads differently from
// one that spends the one the specification names.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseContact } from "./scenario";

/** What the count must read after one contact: one life spent, two to spare. */
const AFTER_ONE_CONTACT = START_LIVES - 1;

/**
 * How long the contact is given to resolve, in frames.
 *
 * The contact test runs inside the update, so a build answers on the first frame
 * the segment is standing in the cursor; 0.05 s of frames costs nothing and leaves
 * room for one that settles it at the end of its own update instead. It is a
 * thirtieth of `RESPAWN_TIME` (`1.4` s), so nothing that follows the life loss can
 * have run to completion and touched the count a second time.
 */
const CONTACT_FRAMES = ticksFor(0.05);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("spends exactly one life on a contact with lives to spare", async () => {
  startPlaying(harness);
  harness.debug.setLives(START_LIVES);
  poseContact(harness);

  await harness.advance(CONTACT_FRAMES);

  captureStill(harness, "lives");
  assertEqual(harness.snapshot().lives, AFTER_ONE_CONTACT);
});
