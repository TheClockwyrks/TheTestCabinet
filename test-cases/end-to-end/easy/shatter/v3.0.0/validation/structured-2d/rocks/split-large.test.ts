// rocks/split-large — a destroyed Large leaves exactly two Medium.
//
// `specs/rocks.md` fixes the ladder: destroying a `large` leaves "Two `medium`",
// destroying a `medium` two `small`, and destroying a `small` nothing. This item is
// the top rung, and it is decided on the field's own counts: one fewer Large than
// before, and two more Medium.
//
// THE ROCK IS SHOT DOWN, NEVER TAKEN OFF THE FIELD. `specs/instrumentation.md` is
// explicit that `clearRocks()` "destroys nothing and scores nothing" and that
// `removeRock(id)` is a removal, so neither produces the event this item is about.
// A real round is placed on the rock's doorstep and the build's own collision and
// split code resolves it (`specs/collision.md`: a bullet and a rock — the bullet is
// removed and the rock is destroyed, which splits and scores). Rounds go in until
// the rock is GONE rather than a fixed number of times, because that number is not
// the same under both variants: one hit under `base`, and under `warhead` the hit
// that takes `ROCK_HEALTH.large` (3) to zero.
//
// BOTH DIRECTIONS ARE ASSERTED, because the two wrong models differ. A build that
// spawns the fragments and leaves the parent standing reads three rocks; a build
// that removes the parent and spawns nothing reads none; a build that spawns ONE
// fragment reads one. Counting only the Mediums would pass the first of those.
//
// THE FIELD HOLDS NOTHING ELSE, so a count is a count: `startPlaying` clears every
// rock, round and saucer and shuts the wave loop and the saucer's arrival off, and
// the one rock this check poses is the only body the counts can be about.
//
// WHAT THIS DOES NOT DECIDE. Where the fragments appear and how fast they leave,
// which are `rocks/fragments-at-the-parents-position` and the three
// `rocks/fragment-kick-*` items; and what the kill scored, which is
// `scoring/large-scores-20`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  rocksOf,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ROCK_GROUND, destroyByGun } from "./scenario";

/**
 * Ticks of the fragments coming apart, run after the reading is taken.
 *
 * The still is the item's evidence, so it is kept AFTER the split has played rather
 * than on the frame the measurement fell on: at `SPLIT_KICK` (90) the two Mediums
 * are some sixty units apart by then and a reviewer can see two of them. Nothing
 * this check asserts is read from it.
 */
const AFTERMATH_TICKS = ticksFor(0.35);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves two Medium and one fewer Large when a Large is shot down", async () => {
  startPlaying(h);
  const parentId = poseRock(h, "large", ROCK_GROUND.x, ROCK_GROUND.y);

  const before = h.snapshot();
  const kill = await destroyByGun(h, parentId);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "split");

  assertLength(
    rocksOf(before, "large"),
    1,
    "the Large this check poses, before the shooting starts " +
      "(specs/instrumentation.md: addRock appends one rock of the size named)",
  );
  assertEqual(
    kill.at.rocks.some((rock) => rock.id === parentId),
    false,
    "the Large gone from the field on the tick it was destroyed " +
      "(specs/collision.md)",
  );
  assertLength(
    rocksOf(kill.at, "large"),
    rocksOf(before, "large").length - 1,
    "Large rocks on the field on the tick the parent broke: one fewer than " +
      "the one that stood there (specs/rocks.md)",
  );
  assertLength(
    rocksOf(kill.at, "medium"),
    rocksOf(before, "medium").length + 2,
    "Medium rocks on the field on the tick the Large broke: the two it comes " +
      "apart into (specs/rocks.md)",
  );
  assertLength(
    kill.at.rocks,
    2,
    "rocks on the field on the tick the Large broke: its two fragments and " +
      "nothing else (specs/rocks.md)",
  );
});
