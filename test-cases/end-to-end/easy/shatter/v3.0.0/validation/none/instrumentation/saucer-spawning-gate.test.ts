// instrumentation/saucer-spawning-gate — `setSaucerSpawning(false)` really does
// shut the game's own arrival of a saucer, and opening it lets one in.
//
// WHY THE FIRST DELAY AND TWO SECONDS OVER. `specs/saucer.md` puts the first
// arrival of a game at `SAUCER_FIRST_DELAY` (18 seconds), so a gate that does
// nothing has let a saucer in by the time the window closes, and a gate that
// works has held the one arrival the cadence owed inside it. The gate's hold over
// LATER arrivals follows from the same faculty, and a watch past the first delay
// would grade the cadence's gaps a second time.
//
// WHY THE GATE MATTERS TO EVERYTHING ELSE. `startPlaying` shuts it for every
// scenario in this project, because a scenario that runs past eighteen seconds of
// game time is otherwise joined by a craft that hunts the ship and fires at it. A
// build whose gate does nothing therefore does not merely fail this item — it puts
// an enemy into every long scenario in the case — which is why the item exists to
// name it.
//
// AND THE OPEN LEG IS GENEROUS ON PURPOSE. It asks only that the gate let an
// arrival happen AT ALL. WHEN it happens is `saucer/first-arrives-at-18s`'s to
// decide, and a window closing on the first delay would make one late arrival cost
// a build two points. Nothing in `specs/instrumentation.md` says what a shut gate
// does to the arrival CLOCK either — a build may hold it while the gate is shut, or
// let it run and arrive the moment the gate opens, and both are conformant — so the
// open leg allows the longest wait either model can produce, the first delay plus
// the longest gap, rather than demanding a schedule the specification never fixed.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull, assertTrue } from "../assert";
import { SAUCER_FIRST_DELAY, SAUCER_GAP_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The game time a shut gate is watched over, in seconds. See the header. */
const QUIET_TIME = SAUCER_FIRST_DELAY + 2;

/**
 * The game time an open gate is given to produce a saucer, in seconds.
 *
 * The first delay plus the longest gap plus five seconds, which covers both of the
 * arrival-clock models a shut gate leaves open and leaves a margin on top.
 */
const ARRIVAL_TIME = SAUCER_FIRST_DELAY + SAUCER_GAP_MAX + 5;

/** How often either stretch is sampled, in ticks: a quarter of a second. */
const POLL = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the saucer away past the first delay while the gate is shut", async () => {
  // `startPlaying` opens with the saucer gate shut, which is the state under test.
  await startPlaying(h);
  const joined = await h.skipUntil((s) => s.saucer !== null, {
    maxTicks: ticksFor(QUIET_TIME),
    poll: POLL,
  });
  await captureStill(h, "quiet");

  assertTrue(
    !joined.hit,
    `no saucer joined over ${QUIET_TIME}s of game time with setSaucerSpawning(false)`,
  );
  assertNull((await h.snapshot()).saucer, `the saucer slot ${QUIET_TIME}s on`);
});

it("lets one in once the gate is open", async () => {
  await startPlaying(h);
  await h.debug.setSaucerSpawning(true);
  const joined = await h.skipUntil((s) => s.saucer !== null, {
    maxTicks: ticksFor(ARRIVAL_TIME),
    poll: POLL,
  });

  assertTrue(
    joined.hit,
    `a saucer arrived within ${ARRIVAL_TIME}s of game time with setSaucerSpawning(true)`,
  );
  requireSaucer(joined.snapshot, "the saucer the open gate let in");
});
