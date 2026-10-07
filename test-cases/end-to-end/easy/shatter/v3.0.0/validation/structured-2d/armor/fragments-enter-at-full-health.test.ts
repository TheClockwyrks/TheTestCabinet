// armor/fragments-enter-at-full-health — a fragment arrives undamaged.
//
// `specs/rocks.md`, Armor: "A fragment enters at full health for its size, so a
// `medium` fragment enters at `2` and a `small` at `1`." This item decides that in
// one direction, on the pair a destroyed Large leaves: both Mediums must report
// `ROCK_HEALTH.medium`.
//
// WHY IT IS A POINT OF ITS OWN. A build that carries the parent's REMAINING health
// into its fragments hands them `0`, and one that carries the parent's FULL health
// hands them `3` — neither of which any other item in this group reads, because
// every other one is about the rock that was struck rather than about what it left.
// Under the first, the two Mediums are already dead and the wave clears on a kill
// that should have replaced one rock with two; under the second, every Medium on
// the field takes a Large's three hits.
//
// BOTH FRAGMENTS, NOT ONE. `specs/collision.md` throws the two to opposite sides
// and `specs/rocks.md` appends them in roster order, so a build that initialises the
// first from the size table and the second from the parent leaves one right and one
// wrong. Reading only the first — or only the last — would pass it.
//
// THE READING IS TAKEN ON THE TICK THE PARENT CAME APART, before the well or the
// wrap has had a tick to work on the field, and the field held nothing but the
// parent, so the only Mediums it can find are the two the split made. The parent is
// destroyed with real rounds placed on its doorstep, rather than by any operation on
// the surface, so what produces the fragments is the build's own collision, armor
// and split code.
//
// ROUNDS ARE SPENT UNTIL IT COMES APART, however many that takes. How many it SHOULD
// take is `armor/health-large-3`'s point: a build that destroys a Large on the first
// round, or takes two, still owes its fragments a Medium's full health, and this
// item has to be able to say so. The ceiling below is a stop for a build nothing
// kills, not an assertion about the figure.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../constants";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  ARMOR_GROUND,
  chipRock,
  findRock,
  healthOf,
  rocksOfSize,
} from "./scene";

/**
 * The most rounds spent before the drive gives up on a parent nothing kills.
 *
 * `ROCK_HEALTH.large` (`3`) with room to spare, so a build that wants a fourth
 * round fails `armor/health-large-3` — the item that grades the figure — rather
 * than silently failing this one.
 */
const MOST_ROUNDS = ROCK_HEALTH.large + 3;

/** What each of the two Medium fragments must report (`specs/rocks.md`). */
const FRAGMENT_HEALTH = ROCK_HEALTH.medium;

/** How many the destroyed Large leaves (`specs/rocks.md`, Splitting). */
const FRAGMENTS = 2;

/** Seconds of the pieces coming apart, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives both Medium fragments a Medium's full health", async () => {
  startPlaying(h);
  const parent = poseRock(h, "large", ARMOR_GROUND.x, ARMOR_GROUND.y);

  let split = await chipRock(h, parent);
  for (
    let round = 2;
    round <= MOST_ROUNDS && findRock(split.at, parent) !== undefined;
    round += 1
  ) {
    split = await chipRock(h, parent);
  }

  assertUndefined(
    findRock(split.at, parent),
    `the Large after ${MOST_ROUNDS} rounds placed on its doorstep: ` +
      "specs/rocks.md destroys a rock on the hit that takes health to 0, and " +
      "its fragments cannot be read until it has come apart",
  );

  const fragments = rocksOfSize(split.at, "medium");

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "fragments");

  assertLength(
    fragments,
    FRAGMENTS,
    "Medium fragments on the tick the Large came apart, which " +
      "specs/rocks.md makes two",
  );
  fragments.forEach((fragment, index) => {
    assertEqual(
      healthOf(fragment, `fragment ${index}`),
      FRAGMENT_HEALTH,
      `fragment ${index}: the health a Medium enters at, which ` +
        `specs/rocks.md makes full for its size — ROCK_HEALTH.medium ` +
        `(${FRAGMENT_HEALTH}) — whatever the parent had left`,
    );
  });
});
