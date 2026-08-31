// armor/health-medium-2 — a Medium takes two hits.
//
// `specs/rocks.md`, Armor: `ROCK_HEALTH.medium` is `2`, a bullet lowers the struck
// rock's health by exactly `1`, the rock is not destroyed while health remains, and
// only the hit that takes health to `0` destroys it. This item decides the FIGURE
// for a Medium, in both directions: one round leaves it standing at health `1`, and
// the second takes it.
//
// BOTH DIRECTIONS, BECAUSE EITHER ALONE PASSES A DIFFERENT WRONG BUILD — a build
// that splits on the first round, and a build nothing kills — and the Medium is the
// size the two most likely mistakes disagree about: a build that gives every rock
// the Large's `3` and one that gives every rock the Small's `1` both fail here, at
// the reading that names which.
//
// The Large and the Small are the sibling checks, so a build that gets one size's
// figure wrong fails exactly that size. The Medium is posed directly rather than
// reached by splitting a Large: `armor/fragments-enter-at-full-health` is the item
// about what a fragment arrives carrying, and a check that shot a Large down first
// would fail for that reason too.
//
// THE FIELD HOLDS THE ROCK AND NOTHING ELSE, and the round comes in from the side
// facing away from the star — see `armor/health-large-3` for both.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../../src/constants";
import { assertEqual, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ARMOR_GROUND, chipRock, findRock, healthOf } from "./scene";

/** The hits a Medium takes before it is destroyed (`specs/rocks.md`). */
const FULL = ROCK_HEALTH.medium;

/** What it must still read after the rounds before the last one. */
const AFTER_ONE = FULL - 1;

/** Seconds of the pieces coming apart, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands through one round at health 1 and is destroyed by the second", async () => {
  startPlaying(h);
  const rock = poseRock(h, "medium", ARMOR_GROUND.x, ARMOR_GROUND.y);

  const first = await chipRock(h, rock);
  const standing = requireRock(
    first.at,
    rock,
    "the Medium standing after one round, which specs/rocks.md leaves " +
      `undestroyed while health remains of its ${FULL}`,
  );
  assertEqual(
    healthOf(standing, "the Medium after one round"),
    AFTER_ONE,
    `the hits a Medium has left after one round, from ROCK_HEALTH.medium ` +
      `(${FULL}) at one per hit (specs/rocks.md)`,
  );

  const second = await chipRock(h, rock);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "armor");

  assertUndefined(
    findRock(second.at, rock),
    "the Medium on the tick the second round landed: specs/rocks.md " +
      `destroys it on the hit that takes health to 0, which is its ${FULL}nd`,
  );
});
