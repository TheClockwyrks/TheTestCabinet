// saucer/at-most-one-at-a-time — a second visit never begins over a live one.
//
// THE RULE. `specs/saucer.md`, The cadence: "At most one saucer is on the field at
// a time... A saucer already on the field is never joined by a second."
//
// WHY THE ID AND NOT A COUNT. `specs/instrumentation.md` makes the saucer a SINGLE
// SLOT rather than a roster — "`snapshot().saucer` is the address" — so there is
// nothing to count, and a check that counted would pass vacuously for every build
// while baking the single slot into the shape it read. What the specification does
// give is identity: every arrival "takes a fresh id, distinct among every live
// entity, and that id is not reused while any live entity holds it, so one visit
// is distinguishable from the next". So the requirement is read as CONTINUITY: a
// live id may be followed by the same live id or by a clear field, and a live id
// followed straight by a DIFFERENT live id is a second visit begun over the first.
// A build whose spawner starts one while the previous is still up shows exactly
// that, whichever of the two its single slot ends up holding.
//
// A MARCHED FRAME IS SAMPLE ENOUGH. The watch reads the slot once a frame, and
// its harness hands the game `MARCH_TICKS` (`8`) whole ticks a frame, a fifteenth
// of a second of game time. That stride cannot hide what it hunts: a second visit
// begun over a live one shows as one live id followed straight by another
// however far apart the samples are, and a conformant build's clear stretch
// between visits lasts `SAUCER_GAP_MIN` (`25` s) and more, which no stride of a
// fifteenth of a second steps over.
//
// THE FIRST DUE IS POSED SHORT, AND THE REST IS THE GAME'S OWN. `setSaucerDue`
// sets the figure the gap draw decides (`specs/instrumentation.md`), so the first
// visit is brought on a quarter of a second in rather than at `18` s; what the
// item reads is what happens ONCE a visit is up, and the cadence after that
// visit — its `12`-second stay and the `25`–`35` s gap the game draws when it
// leaves — is untouched. Fifty seconds of game time is therefore long enough to
// hold two arrivals on any conformant build, so the requirement is exercised
// across visits rather than asserted over one.
//
// AT LEAST TWO VISITS ARE REQUIRED. A run that produced one saucer, or none, could
// not have shown an overlap and must not be reported as having ruled one out — so
// the count is asserted before the continuity is.
//
// NOTHING ELSE IS LEFT RUNNING. The game is really opened, the wave loop is shut
// and the opening wave taken off, and the ship's lethal contact test is shut, so
// fifty seconds pass without a wave, a death or a game over interrupting the
// cadence. `saucerSpawning` is left on: the arrivals have to be the game's own.
//
// WHAT THIS DOES NOT DECIDE. When the arrivals come — `saucer/first-arrives-at-18s`
// and `saucer/subsequent-gap` own the two figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { captureStill, type Harness } from "../harness";
import {
  createMarchHarness,
  marchFrames,
  openQuietGame,
  SHORT_DUE,
  watchVisits,
} from "./visits";

/**
 * How much game time the slot is watched for, in seconds.
 *
 * The first arrival is due at the posed `SHORT_DUE` and the second no later than
 * `0.25 + 12 + 35` = `47.25` s, so fifty holds two visits on any conformant
 * build.
 */
const WATCH_SECONDS = 50;

/**
 * The fewest visits the watch has to have seen for its verdict to mean anything.
 *
 * Two. The requirement is about one visit following another, so a run that held
 * only one had no changeover to get wrong, and a pass over it would be a pass over
 * a scenario that was never posed.
 */
const MIN_VISITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createMarchHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never reports one live saucer id giving way to another without a clear sample between", async () => {
  const opened = await openQuietGame(h);
  h.debug.setSaucerDue(SHORT_DUE);

  let filmed = false;
  const watch = await watchVisits(h, marchFrames(WATCH_SECONDS) - opened, {
    onArrival: async () => {
      if (filmed) return;
      filmed = true;
      // One visit on the field at a time: the first arrival. The watch runs
      // undrawn, so one frame is drawn for this picture — the frame after the
      // arrival the watch read.
      await h.paint();
      captureStill(h, "visit");
    },
  });

  assertGreaterThanOrEqual(
    watch.visits.length,
    MIN_VISITS,
    `saucer visits over ${WATCH_SECONDS} s of game time with the game's own ` +
      "arrival running and the first due posed short — fewer than two is a run " +
      "with no changeover to check (specs/saucer.md, The cadence)",
  );
  assertEqual(
    watch.overlaps.length,
    0,
    "samples on which a live saucer id gave way to another live one with no " +
      "sample between reporting the slot clear — a saucer already on the field " +
      `is never joined by a second (specs/saucer.md): ${watch.overlaps.join("; ")}`,
  );
});
