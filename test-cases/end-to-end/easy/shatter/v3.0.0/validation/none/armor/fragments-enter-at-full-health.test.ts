// rocks/fragments-enter-at-full-health — a fragment enters at full health.
//
// `specs/rocks.md`: "A fragment enters at full health for its size, so a `medium`
// fragment enters at `2` and a `small` at `1`." It is the rule that keeps the armor
// table honest as a wave is played down: a build that carried the parent's
// REMAINING health into its fragments would hand the player two Mediums with one
// hit left each, and a Large would cost five rounds to clear rather than seven.
//
// THE PARENT IS THE ONLY ROCK ON THE FIELD, so the two rocks standing on the tick
// it comes apart are its fragments and nothing else — no wave arriving behind the
// scenario, no rock posed as a bystander whose health could be read by mistake. The
// Large is taken down by real rounds through the build's own collision and split
// code, because the fragments this reads have to be the ones the game made.
//
// The SIZE of a fragment is `rocks/split-large`'s item and the count is its own;
// what is read here is the health each of them entered with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ROCK_CHILD, ROCK_HEALTH } from "../constants";
import {
  captureStill,
  createHarness,
  destroyRock,
  poseRock,
  rocksOfSize,
  startPlaying,
  type Harness,
} from "../harness";
import { CHIP_SPOT, healthOf } from "./scene";

/** What a Large leaves: two of the size below it. */
const CHILD = ROCK_CHILD.large ?? "medium";

/** The health a fragment of that size enters at: its size's full health. */
const CHILD_FULL = ROCK_HEALTH[CHILD];

/** How many fragments a destroyed rock leaves (specs/rocks.md). */
const FRAGMENTS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives each Medium fragment of a destroyed Large its size's full health", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);

  const killed = await destroyRock(h, id);
  await captureStill(h, "fragments");

  const fragments = rocksOfSize(killed.result.snapshot, CHILD);
  assertLength(
    fragments,
    FRAGMENTS,
    `the ${CHILD} fragments a destroyed Large leaves (specs/rocks.md)`,
  );
  for (const [index, fragment] of fragments.entries()) {
    assertEqual(
      healthOf(fragment, `fragment ${index}`),
      CHILD_FULL,
      `fragment ${index}: the health a ${CHILD} enters at (specs/rocks.md)`,
    );
  }
});
