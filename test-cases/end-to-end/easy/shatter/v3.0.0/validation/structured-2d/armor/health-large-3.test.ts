// armor/health-large-3 — a Large takes three hits.
//
// `specs/rocks.md`, Armor: a rock carries health, `ROCK_HEALTH.large` is `3`, "a
// bullet that hits a rock lowers that rock's health by exactly `1`", "while health
// remains the rock is not destroyed", and "only the hit that takes health to `0`
// destroys the rock". This item decides the FIGURE for a Large, in both directions:
// two rounds leave it standing at health `1`, and the third takes it.
//
// BOTH DIRECTIONS, BECAUSE EITHER ALONE PASSES A DIFFERENT WRONG BUILD. A check
// that only asked whether three rounds killed it would pass a build that splits on
// the first; one that only asked whether it survived two would pass a build that
// nothing kills. The pair pins `3` and nothing else: a build with `ROCK_HEALTH`
// read off the wrong size, or one that takes two off a hit, fails at the reading
// that names which.
//
// THE FIGURE ITSELF, NOT THE ARITHMETIC. That each hit costs exactly one is
// `armor/health-falls-by-one`'s point, and it poses the health it starts from; this
// one lets the rock arrive at its size's full health the way `addRock` delivers it
// (`specs/instrumentation.md`: "at full health for its size"), so the two items
// fail apart. The Medium and the Small are the sibling checks, so a build that gets
// one size's figure wrong fails exactly that size.
//
// THE FIELD HOLDS THE PARENT AND NOTHING ELSE. `startPlaying` empties every roster
// and shuts both world gates and the ship's contact test, so nothing arrives on top
// of the reading, and each round is placed on the rock's doorstep on the side
// facing away from the star so `specs/collision.md`'s absorption at the core cannot
// take it on the way in.

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

/** The hits a Large takes before it is destroyed (`specs/rocks.md`). */
const FULL = ROCK_HEALTH.large;

/** What it must still read after the rounds before the last one. */
const AFTER_TWO = FULL - 2;

/** Seconds of the pieces coming apart, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands through two rounds at health 1 and is destroyed by the third", async () => {
  startPlaying(h);
  const rock = poseRock(h, "large", ARMOR_GROUND.x, ARMOR_GROUND.y);

  const first = await chipRock(h, rock);
  requireRock(
    first.at,
    rock,
    "the Large standing after one round, which specs/rocks.md leaves " +
      `undestroyed while health remains of its ${FULL}`,
  );

  const second = await chipRock(h, rock);
  const standing = requireRock(
    second.at,
    rock,
    "the Large standing after two rounds, which specs/rocks.md leaves " +
      `undestroyed while health remains of its ${FULL}`,
  );
  assertEqual(
    healthOf(standing, "the Large after two rounds"),
    AFTER_TWO,
    `the hits a Large has left after two rounds, from ROCK_HEALTH.large ` +
      `(${FULL}) at one per hit (specs/rocks.md)`,
  );

  const third = await chipRock(h, rock);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "armor");

  assertUndefined(
    findRock(third.at, rock),
    "the Large on the tick the third round landed: specs/rocks.md destroys " +
      `it on the hit that takes health to 0, which is its ${FULL}th`,
  );
});
