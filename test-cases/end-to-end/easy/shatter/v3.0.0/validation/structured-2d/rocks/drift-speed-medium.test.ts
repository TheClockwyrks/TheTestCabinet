// rocks/drift-speed-medium — a Medium enters the field inside its own speed range.
//
// `specs/rocks.md` gives each size a base drift speed, "the speed it enters the
// field with, drawn uniformly from its size's range": `ROCK_SPEED_MIN.medium` to
// `ROCK_SPEED_MAX.medium` (90 to 150) for a Medium. The three ranges are what make
// the sizes play differently — a Large lumbers and a Small darts — so a build that
// draws every rock from one range, or that uses the Large's range for everything,
// has a field with no texture to it.
//
// A Medium REACHES THE FIELD BY RECYCLING, which is where this item reads it.
// `specs/progression.md` spawns Large rocks and nothing else, so the only way a
// Medium enters the field carrying a base drift speed of its own is
// `specs/rocks.md`'s star recycling: a rock the core takes "re-enters [...] at a
// fresh base drift speed drawn from its size's range". A fragment is not that — a
// fragment takes its parent's velocity plus a kick (`specs/collision.md`), which is
// the three `rocks/fragment-kick-*` items' business and not a draw from a range at
// all.
//
// 6 ENTRIES ARE READ, NOT ONE. The speed is a DRAW (`specs/simulation.md`), so one
// sample says almost nothing: a build drawing from the Large's range would land
// inside a Medium's about a third of the time. Each pass is a real trip through the core
// — the rock is aimed back at the star at 400 units per second and followed in
// again — so the draws are the ones the build would make in play, and every one of
// them is asserted, as the review item states. Nothing is posed for the speed:
// `setNextRockSpeed` is how a check that wants a particular one gets it, and this
// check wants the build's own draws.
//
// THE ROCK IS SLUNG IN FASTER THAN THE RANGE, at 400 units per second, and
// `specs/gravity.md`'s well only adds to that on the way in. So a build that
// relocates the rock without redrawing its speed cannot land inside the range by
// accident: it reads 400 or more.
//
// THE READING IS TAKEN ON THE TICK IT RE-ENTERED, swept one tick at a time
// (`scenario.ts`), so what is measured is the speed the star gave the rock rather
// than one the well has had a second to work on.
//
// WHAT THIS DOES NOT DECIDE. That the rock comes back at all, or where, which are
// the `rocks/recycle-*` items'; that a Large's own range is right, which is
// `rocks/drift-speed-large`'s, read off a spawned wave rather than a recycle; and
// how the wave multiplier scales a spawn, which is `waves/speed-scales-per-wave`'s.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_SPEED_MAX, ROCK_SPEED_MIN } from "../constants";
import { assertBetween, assertGreaterThan } from "../assert";
import { speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
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

/** How many entries are read, so a range is graded rather than a single draw. */
const PASSES = 6;

/**
 * How far outside the stated range an entry speed may fall: two percent, as the
 * review item states.
 *
 * Room for a build's own arithmetic and for the tick the reading lands on, not for
 * the environment: at the edge the rock re-enters at — no nearer the star than 360
 * units — `specs/gravity.md`'s well adds under a third of a unit per second in a
 * tick, a tenth of the allowance below. The wrong model it is set against reads
 * 400, or the Large's range that begins at 60.
 */
const TOLERANCE = 0.02;

/** Ticks of the last recycled rock coming in, run after the readings are taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every re-entering Medium a speed inside ROCK_SPEED_MIN.medium to ROCK_SPEED_MAX.medium", async () => {
  startPlaying(h);
  dropOntoTheStar(h, "medium");

  const entries: Recycle[] = [];
  for (let pass = 1; pass <= PASSES; pass += 1) {
    entries.push(pass === 1 ? await slingIntoTheStar(h) : await slingAgain(h));
  }

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "entry");

  for (const [index, recycle] of entries.entries()) {
    const label = `entry ${index + 1}`;

    const arriving = theOneRock(
      recycle.before,
      `${label}: the Medium on its way into the core`,
    );
    assertGreaterThan(
      speedOf(arriving),
      ROCK_SPEED_MAX.medium,
      `${label}: the speed the Medium carried into the star, which the ` +
        `scenario slings at ${SLING_SPEED} and specs/gravity.md's well only ` +
        "adds to — so a re-entry inside the size's range can only be a fresh draw",
    );

    const back = theOneRock(
      recycle.at,
      `${label}: the Medium the star gave back`,
    );
    assertBetween(
      speedOf(back),
      ROCK_SPEED_MIN.medium * (1 - TOLERANCE),
      ROCK_SPEED_MAX.medium * (1 + TOLERANCE),
      `${label}: the speed the re-entering Medium carried — specs/rocks.md ` +
        `draws a fresh base drift speed uniformly from its size's range, ` +
        `${ROCK_SPEED_MIN.medium} to ${ROCK_SPEED_MAX.medium}, within two percent`,
    );
  }
});
