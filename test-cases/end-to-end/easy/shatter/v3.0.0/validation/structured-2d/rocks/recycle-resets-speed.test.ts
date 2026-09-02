// rocks/recycle-resets-speed — the star hands a rock back at a fresh drift speed.
//
// `specs/rocks.md`, Star recycling: the rock re-enters "at a fresh base drift speed
// drawn from its size's range". The consequence is the reason the rule exists: a
// rock falls into the well, is accelerated hard on the way in, and would come back
// out faster every time if the star simply relocated it — a few laps and the field
// holds rocks no player can react to. This item is the guarantee that repeated
// recycling never accelerates a rock.
//
// THE ROCK IS SLUNG IN AT 400 UNITS PER SECOND, which is what makes the reset
// visible. `specs/rocks.md` gives a Large a base drift of `ROCK_SPEED_MIN.large` to
// `ROCK_SPEED_MAX.large` (60 to 110) and `specs/gravity.md`'s well only ADDS to a
// rock's speed on the way in, so a rock arriving at 400 or more and leaving at
// anything inside that range cannot be carrying the speed it came in with. The
// approach speed is asserted rather than assumed, so a build whose rock crawls into
// the core does not pass this on a coincidence.
//
// THREE PASSES, because the claim is about REPEATED recycling. A build that redraws
// the speed on the first pass and then relocates thereafter — or one that adds the
// old speed to the new draw — reads higher on each successive lap, which one pass
// cannot see. Each pass slings the same rock back at 400 through the star again.
//
// THE TOLERANCE IS THE WELL AND NOTHING ELSE. `specs/rocks.md` states the range as
// the BASE drift speed the rock re-enters with, and `specs/gravity.md`'s well is
// already acting on it at the moment of the reading; the re-placement is swept one
// tick at a time, so the allowance is a few ticks of the pull AT THE POSITION IT
// RE-ENTERED, computed from the law the specification states rather than assumed.
// It comes to a fraction of a unit per second against a range 50 wide.
//
// WHAT THIS DOES NOT DECIDE. That the ranges themselves are right for a Medium and
// a Small entering, which are `rocks/drift-speed-medium` and
// `rocks/drift-speed-small`; where the rock came back, which is
// `rocks/recycle-re-enters-from-off-screen`'s; and, under `warhead`, that its health
// is NOT reset with its speed, which is `armor/recycling-resets-speed-not-health`'s.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_SPEED_MAX, ROCK_SPEED_MIN, TICK_HZ } from "../constants";
import { assertBetween, assertGreaterThan } from "../assert";
import { pullAt, speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  SLING_SPEED,
  dropOntoTheStar,
  slingAgain,
  slingIntoTheStar,
  theOneRock,
  type Recycle,
} from "./scenario";

/** How many trips through the core are read, so "repeated" is really tested. */
const PASSES = 3;

/** The seed the run is put on, so the speeds the star draws are reproducible. */
const SEED = 1;

/**
 * How many ticks of the well's pull the re-entry speed is allowed to carry.
 *
 * The re-placement is swept one tick at a time, so the reading falls on the tick it
 * happened; three is that with room for a build that runs its gravity pass before
 * its recycling pass, or a tick either side of it.
 */
const SETTLE_TICKS = 3;

/** Ticks of the last recycled rock coming in, run after the readings are taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a Large slung in at 400 units per second at a Large's own drift speed", async () => {
  resetTo(h, SEED);
  startPlaying(h);
  dropOntoTheStar(h, "large");

  const passes: Recycle[] = [];
  for (let pass = 1; pass <= PASSES; pass += 1) {
    passes.push(pass === 1 ? await slingIntoTheStar(h) : await slingAgain(h));
  }

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "recycle");

  for (const [index, recycle] of passes.entries()) {
    const label = `pass ${index + 1}`;

    const arriving = theOneRock(
      recycle.before,
      `${label}: the Large on its way into the core`,
    );
    assertGreaterThan(
      speedOf(arriving),
      ROCK_SPEED_MAX.large,
      `${label}: the speed the Large carried into the star, which the scenario ` +
        `slings at ${SLING_SPEED} and specs/gravity.md's well only adds to — so ` +
        "a re-entry inside the size's range can only be a fresh draw",
    );

    const back = theOneRock(
      recycle.at,
      `${label}: the Large the star gave back`,
    );
    // The well is already pulling on the rock where it re-entered, so the
    // allowance is the pull specs/gravity.md's law gives THERE over the ticks the
    // sweep can be behind by.
    const allowance = pullAt(back) * (SETTLE_TICKS / TICK_HZ);

    assertBetween(
      speedOf(back),
      ROCK_SPEED_MIN.large - allowance,
      ROCK_SPEED_MAX.large + allowance,
      `${label}: the speed the recycled Large re-entered at — specs/rocks.md ` +
        `draws a fresh base drift speed from its size's range, ` +
        `${ROCK_SPEED_MIN.large} to ${ROCK_SPEED_MAX.large}, allowing ` +
        `${allowance.toFixed(2)} for the well over ${SETTLE_TICKS} ticks`,
    );
  }
});
