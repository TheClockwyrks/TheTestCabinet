// progression/life-lost-decrements — a contact with lives to spare costs one
// life, and one only.
//
// `specs/progression.md`, Losing a life: "A worm segment or a foe reaching the
// cursor costs one life, as `specs/cursor.md` states. On the contact, with lives
// to spare: 1. Lives falls by one." The board is posed with the three lives a
// run starts with, so there are lives to spare and the run does not end
// (`START_LIVES` is `3`, and the contact that takes lives to `0` is the point
// `progression/game-over-at-zero-lives` decides).
//
// The reading is the number itself, and it names every wrong model apart: a
// build that never counts the contact answers `3`; one that ends the run on any
// contact, or that empties the lives on one, answers `0`; one that charges the
// contact twice — once for the segment and once again on the frame that follows
// — answers `1`; a correct build answers `2`.
//
// The board carries one worm segment, standing in the cursor's box, and nothing
// else. THAT the contact costs a life is `cursor/worm-contact-costs-life`; what
// it costs is this.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { contactCursor } from "./run";

/** The lives the board is posed with: a full run, so there are lives to spare. */
const POSED_LIVES = START_LIVES;

/** What the contact leaves: one life fewer, and no more than one. */
const AFTER_CONTACT = POSED_LIVES - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves two lives after one contact from three", async () => {
  await startPlaying(h);
  await h.debug.setLives(POSED_LIVES);

  await contactCursor(h);

  await captureStill(h, "lives");
  assertEqual(
    (await h.snapshot()).lives,
    AFTER_CONTACT,
    `the lives left after one contact from ${POSED_LIVES}`,
  );
});
