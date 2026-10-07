// armor/health-small-1 — a Small takes one hit.
//
// `specs/rocks.md`, Armor: `ROCK_HEALTH.small` is `1`, a bullet lowers the struck
// rock's health by exactly `1`, and the hit that takes health to `0` destroys the
// rock. For a Small that is the FIRST hit, so the armor rule leaves the smallest
// size exactly where the unarmored game left it: one round and it is gone.
//
// ONE DIRECTION, BECAUSE THE SMALL HAS ONLY ONE. There is no "still standing"
// reading to pair this with — a Small at full health is one hit from nothing — so
// what this item decides is that armor did not make the smallest rock tougher than
// its figure says. A build that gave every rock the Large's `3`, or that reads
// `ROCK_HEALTH` off the wrong size, survives the round and fails here; the Large
// and the Medium are the sibling checks, so such a build fails each size it got
// wrong rather than one item three times over.
//
// WHAT IS NOT ASSERTED HERE is that a destroyed Small leaves nothing behind. That
// is `rocks/split-small`'s point under both variants, and reading the roster's
// length here would fail a build with a working armor table and a broken split
// ladder twice.
//
// THE FIELD HOLDS THE ROCK AND NOTHING ELSE, and the round comes in from the side
// facing away from the star — see `armor/health-large-3` for both.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../constants";
import { assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ARMOR_GROUND, chipRock, findRock } from "./scene";

/** The hits a Small takes before it is destroyed (`specs/rocks.md`). */
const FULL = ROCK_HEALTH.small;

/** Seconds of the field without it, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("is destroyed by a single round", async () => {
  startPlaying(h);
  const rock = poseRock(h, "small", ARMOR_GROUND.x, ARMOR_GROUND.y);

  const landed = await chipRock(h, rock);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "armor");

  assertUndefined(
    findRock(landed.at, rock),
    "the Small on the tick the round landed: specs/rocks.md destroys a rock " +
      `on the hit that takes health to 0, which is a Small's ${FULL}st`,
  );
});
