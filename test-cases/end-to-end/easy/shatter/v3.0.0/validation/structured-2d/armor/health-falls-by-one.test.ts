// armor/health-falls-by-one — each hit costs exactly one health.
//
// `specs/rocks.md`, Armor: "A bullet that hits a rock lowers that rock's health by
// exactly `1`". This item decides the ARITHMETIC rather than any one size's figure:
// the Large is POSED at health `3` through `setRockHealth` and read back after each
// of two rounds, so the reading is `3 → 2 → 1` and a build that takes two off a
// hit, or that clamps to `1`, or that lowers health only on some hits, fails at the
// reading that names which.
//
// TWO ROUNDS, NOT ONE. One round distinguishes a fall of `1` from a fall of `2`,
// but not from a build that sets health to `size's full - 1` on every hit — which
// reads `2` after the first round and `2` again after the second. The second
// reading is what pins a fall PER HIT rather than a single assignment.
//
// THE HEALTH IS POSED, NOT INHERITED. `armor/health-large-3` is the item that
// grades `ROCK_HEALTH.large` itself, and it lets `addRock` deliver the rock at its
// size's full health; this one states the health it starts from, so a build with
// the right arithmetic and a wrong table fails there and passes here. The value
// posed is the size's full health, which is the largest `setRockHealth` accepts
// (`specs/instrumentation.md`: "a whole number from `1` to the full health of its
// size") and leaves two chipping hits before the rock is destroyed.
//
// THE FIELD HOLDS THE ROCK AND NOTHING ELSE, and each round comes in from the side
// facing away from the star — see `armor/health-large-3` for both.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ARMOR_GROUND, chipRock, healthOf, poseHealth } from "./scene";

/** The health the Large is posed at: the largest `setRockHealth` takes for it. */
const POSED = ROCK_HEALTH.large;

/** What one hit must leave, at `specs/rocks.md`'s exactly one per hit. */
const AFTER_ONE = POSED - 1;

/** What two hits must leave. */
const AFTER_TWO = POSED - 2;

/** Seconds of the chipped rock drifting on, filmed after the readings are taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports one fewer hit left after each round", async () => {
  startPlaying(h);
  const rock = poseRock(h, "large", ARMOR_GROUND.x, ARMOR_GROUND.y);
  poseHealth(h, rock, POSED);

  assertEqual(
    healthOf(
      requireRock(h.snapshot(), rock, "the Large the scenario posed"),
      "the posed Large",
    ),
    POSED,
    "the health the Large was posed at, before any round is fired " +
      "(specs/instrumentation.md)",
  );

  const first = await chipRock(h, rock);
  assertEqual(
    healthOf(
      requireRock(
        first.at,
        rock,
        `the Large still standing after one round of the ${POSED} it takes`,
      ),
      "the Large after one round",
    ),
    AFTER_ONE,
    `the hits left after one round, from ${POSED} at exactly one per hit ` +
      "(specs/rocks.md)",
  );

  const second = await chipRock(h, rock);
  const twice = requireRock(
    second.at,
    rock,
    `the Large still standing after two rounds of the ${POSED} it takes`,
  );

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "armor");

  assertEqual(
    healthOf(twice, "the Large after two rounds"),
    AFTER_TWO,
    `the hits left after two rounds, from ${POSED} at exactly one per hit ` +
      "(specs/rocks.md)",
  );
});
