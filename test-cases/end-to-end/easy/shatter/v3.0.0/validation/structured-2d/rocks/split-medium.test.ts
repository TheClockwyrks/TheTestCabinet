// rocks/split-medium — a destroyed Medium leaves exactly two Small.
//
// `specs/rocks.md` fixes the middle rung of the ladder: destroying a `medium`
// leaves "Two `small`". It is its own item rather than a second reading of
// `rocks/split-large` because the two rungs are separately implementable and
// separately wrong: a build with one hard-coded fragment size splits a Large
// correctly and hands a Medium two Mediums, or two Larges, and a build that halts
// the ladder one rung early leaves a destroyed Medium with nothing behind it.
//
// THE ROCK IS SHOT DOWN, NEVER TAKEN OFF THE FIELD. `specs/instrumentation.md` is
// explicit that `clearRocks()` "destroys nothing and scores nothing" and that
// `removeRock(id)` is a removal, so neither produces the event this item is about.
// A real round is placed on the rock's doorstep and the build's own collision and
// split code resolves it. Rounds go in until the rock is GONE rather than a fixed
// number of times, because that number is not the same under both variants: one hit
// under `base`, and under `warhead` the hit that takes `ROCK_HEALTH.medium` (2) to
// zero.
//
// BOTH DIRECTIONS ARE ASSERTED — one fewer Medium and two more Small — so a build
// that spawns the fragments and leaves the parent standing, one that spawns
// nothing, and one that spawns a single fragment are each named by the count they
// get wrong.
//
// THE FIELD HOLDS NOTHING ELSE, so a count is a count: `startPlaying` clears every
// rock, round and saucer and shuts the wave loop and the saucer's arrival off.
//
// WHAT THIS DOES NOT DECIDE. Where the fragments appear and how fast they leave,
// which are `rocks/fragments-at-the-parents-position` and the three
// `rocks/fragment-kick-*` items; and what the kill scored, which is
// `scoring/medium-scores-50`'s.

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

/** Ticks of the fragments coming apart, run after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.35);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves two Small and one fewer Medium when a Medium is shot down", async () => {
  startPlaying(h);
  const parentId = poseRock(h, "medium", ROCK_GROUND.x, ROCK_GROUND.y);

  const before = h.snapshot();
  const kill = await destroyByGun(h, parentId);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "split");

  assertLength(
    rocksOf(before, "medium"),
    1,
    "the Medium this check poses, before the shooting starts " +
      "(specs/instrumentation.md: addRock appends one rock of the size named)",
  );
  assertEqual(
    kill.at.rocks.some((rock) => rock.id === parentId),
    false,
    "the Medium gone from the field on the tick it was destroyed " +
      "(specs/collision.md)",
  );
  assertLength(
    rocksOf(kill.at, "medium"),
    rocksOf(before, "medium").length - 1,
    "Medium rocks on the field on the tick the parent broke: one fewer than " +
      "the one that stood there (specs/rocks.md)",
  );
  assertLength(
    rocksOf(kill.at, "small"),
    rocksOf(before, "small").length + 2,
    "Small rocks on the field on the tick the Medium broke: the two it comes " +
      "apart into (specs/rocks.md)",
  );
  assertLength(
    kill.at.rocks,
    2,
    "rocks on the field on the tick the Medium broke: its two fragments and " +
      "nothing else (specs/rocks.md)",
  );
});
