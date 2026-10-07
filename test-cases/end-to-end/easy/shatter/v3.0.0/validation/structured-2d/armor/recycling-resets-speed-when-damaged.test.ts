// armor/recycling-resets-speed-when-damaged — damage does not divert the recycle
// path off its fresh drift speed.
//
// THE RULE, AND THE ONE THING THIS ITEM DECIDES. `specs/rocks.md`, Star recycling:
// a recycled rock "re-enters at a point on one of the four edges of the field
// ... heading inward into the field, at a fresh base drift speed drawn uniformly
// from its size's range", and, under `warhead`, "Its speed is reset and its health
// is not."
// Each half is already owned. `rocks/recycle-resets-speed` decides the reset
// itself, on a whole rock; `armor/recycling-preserves-health` decides that the
// damage survives. What neither of them takes is the recycle path with a DAMAGED
// rock on it, and that is the whole of this item: a build that branches on health —
// re-placing a chipped rock at the speed it arrived with, or at rest, rather than
// drawing it a fresh one — passes both owners and fails here alone.
//
// SO THE HEALTH IS A PRECONDITION HERE AND NOT A VERDICT. It is posed and read back
// BEFORE the fall, so a build that cannot pose a health fails
// `armor/set-rock-health-reads-back` by name rather than being misread as a
// recycling fault. Nothing is read off the health after the re-entry: that reading
// is `armor/recycling-preserves-health`'s, taken in an identical world.
//
// THE RESET IS VISIBLE ONLY BECAUSE THE APPROACH IS FAST. The rock is dropped
// inward at `FALL_SPEED` (`150`), already above a Large's `ROCK_SPEED_MAX.large`
// (`110`), and `specs/gravity.md`'s well only adds to that on the way in — so a
// re-entry speed inside the size's range cannot be the speed it arrived with, and a
// build that simply relocates the rock without redrawing its drift fails. That
// approach speed is asserted, so a build whose rock crawls into the core would fail
// naming the scenario rather than passing this on a coincidence.
//
// THE TOLERANCE IS THE WELL, AND NOTHING ELSE. `specs/rocks.md` states the range as
// the BASE drift speed the rock enters with, and `specs/gravity.md`'s well is
// already acting on it at the moment the reading is taken. The reading is swept one
// tick at a time, so at most a tick or two of pull has been added; the allowance is
// three ticks of the pull at the position it actually re-entered at, computed from
// the law `specs/gravity.md` states rather than assumed.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_HEALTH,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  TICK_HZ,
} from "../constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { pullAt, speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  dropOntoTheStar,
  FALL_SPEED,
  healthOf,
  poseHealth,
  slingIntoTheStar,
  theOneRock,
} from "./scene";

/** The health the Large is chipped to before it is slung in. */
const CHIPPED = 1;

/** A Large's full health, which a build that re-places a fresh rock would report. */
const FULL = ROCK_HEALTH.large;

/**
 * How many ticks of the well's pull the re-entry speed is allowed to carry.
 *
 * The re-placement is swept one tick at a time, so the reading is taken on the tick
 * it happened; three is that with room for a build that applies its gravity pass
 * before its recycling pass, or a tick either side of it.
 */
const SETTLE_TICKS = 3;

/** Seconds of the recycled rock coming back in, filmed after the readings. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a chipped Large at a Large's own drift speed", async () => {
  startPlaying(h);
  const rock = dropOntoTheStar(h, "large");
  poseHealth(h, rock, CHIPPED);
  // A SETUP GUARD, not the verdict: the damage the recycle path is asked to carry
  // has to be really on the rock before it falls, and a build that cannot pose one
  // is failed by `armor/set-rock-health-reads-back` under its own name.
  assertEqual(
    healthOf(
      theOneRock(h.snapshot(), "the chipped Large"),
      "the chipped Large",
    ),
    CHIPPED,
    "the health the rock carried into the star, which the scenario posed at " +
      `${CHIPPED} of its ROCK_HEALTH.large (${FULL}) ` +
      "(specs/instrumentation.md)",
  );

  const recycle = await slingIntoTheStar(h);

  const arriving = theOneRock(
    recycle.before,
    "the Large on its way into the core",
  );
  assertGreaterThan(
    speedOf(arriving),
    ROCK_SPEED_MAX.large,
    "the speed the Large carried into the star, which the scenario drops at " +
      `FALL_SPEED (${FALL_SPEED}) and specs/gravity.md's well only adds to — ` +
      "so a re-entry inside the size's range can only be a reset",
  );

  const back = theOneRock(recycle.at, "the Large the star gave back");
  // The well is already pulling on the rock at the position it re-entered at, so
  // the allowance is the pull the law in specs/gravity.md gives THERE, over the
  // ticks the sweep can be behind by.
  const allowance = pullAt(back) * (SETTLE_TICKS / TICK_HZ);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "recycle");

  assertBetween(
    speedOf(back),
    ROCK_SPEED_MIN.large - allowance,
    ROCK_SPEED_MAX.large + allowance,
    "the speed the recycled Large re-entered at: specs/rocks.md draws a " +
      `fresh base drift speed from its size's range, ` +
      `${ROCK_SPEED_MIN.large} to ${ROCK_SPEED_MAX.large}, allowing ` +
      `${allowance.toFixed(2)} for the well over ${SETTLE_TICKS} ticks`,
  );
});
