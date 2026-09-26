// armor/non-fatal-hit-does-not-split — a chipping hit leaves the rock whole.
//
// `specs/rocks.md`, Armor: "While health remains the rock is not destroyed, does
// not split, and scores nothing", and "Only the hit that takes health to `0`
// destroys the rock, at which point it splits". This item decides the SPLIT half of
// that in one direction: the round that takes a Large from `3` to `2` must leave
// the field holding exactly the rock it started with.
//
// THE COUNT IS READ OFF BOTH SIDES OF THE HIT, the tick before and the tick it
// landed, so nothing else can have entered the field between them and a build that
// spawns its fragments a tick early is caught by the pair rather than passing on a
// count taken too soon.
//
// THE COUNT, AND ALSO THE ROCK. A build that splits on every hit and REMOVES the
// parent leaves two Mediums, so the count rises and the count alone catches it. A
// build that splits on every hit and leaves the parent standing also leaves two
// Mediums — the count catches that too — but a build that REPLACES the Large with a
// single Medium leaves the count at one, so the rock the check began with is
// asserted still to be on the field, at its own size. The pair pins "nothing
// happened to the roster" rather than "the roster is the same length".
//
// A CHIPPING HIT, NOT A FATAL ONE: the Large arrives at its full
// `ROCK_HEALTH.large` (`3`) and one round leaves it standing. That it survived is
// `armor/health-large-3`'s point and is the precondition here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ARMOR_GROUND, chipRock } from "./scene";

/** What the field holds throughout: the one rock the scenario posed. */
const POSED_ROCKS = 1;

/** Seconds of the chipped rock drifting on, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the rock roster exactly as it was", async () => {
  startPlaying(h);
  const rock = poseRock(h, "large", ARMOR_GROUND.x, ARMOR_GROUND.y);

  const chip = await chipRock(h, rock);

  assertLength(
    chip.before.rocks,
    POSED_ROCKS,
    "rocks on the field on the tick before the round landed, which the " +
      "scenario posed as one Large",
  );

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "chip");

  assertLength(
    chip.at.rocks,
    POSED_ROCKS,
    "rocks on the field on the tick the chipping round landed: " +
      "specs/rocks.md splits a rock only on the hit that takes its health to 0",
  );
  const whole = requireRock(
    chip.at,
    rock,
    "the chipped Large itself, still on the field rather than replaced by a " +
      "fragment (specs/rocks.md)",
  );
  assertEqual(
    whole.size,
    "large",
    "the size of the chipped rock, which specs/rocks.md leaves untouched by " +
      "a hit that does not destroy it",
  );
});
