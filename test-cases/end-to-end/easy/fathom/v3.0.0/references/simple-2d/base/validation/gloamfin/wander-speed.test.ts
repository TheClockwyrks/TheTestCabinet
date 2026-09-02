// gloamfin/wander-speed — it wanders at a steady PREDATOR_SPEED.
//
// THE CLAIM. `specs/predators/gloamfin.md` gives the Gloamfin one speed while it
// wanders — "`PREDATOR_SPEED` (`116`), steady for as long as it wanders" — and
// says of it that "the wander speed never winds up: a Gloamfin that has wandered
// for a minute travels at `PREDATOR_SPEED` exactly as one released a moment ago".
// So there are two readings, a minute apart, and each is taken twice over: what
// the snapshot REPORTS as `speed` (`specs/state.md`: "its current speed, in
// logical units per second") and what the Gloamfin actually COVERS.
//
// BOTH, BECAUSE EITHER ALONE PASSES A BROKEN BUILD. A build that reports `116` and
// travels at a hundred and forty is wrong, and so is one that travels correctly and
// reports a figure it never uses; the two readings together leave neither open.
//
// WHY THE PATROL IS SEALED OFF FROM THE FORAGER. This measures a WANDER, and a
// Gloamfin that hears the forager stops wandering and chases at a different speed
// entirely. On a maze `specs/maze.md` describes — one connected region — "far
// away" lasts only until the patrol arrives, and a minute is long enough for it to
// cross the board many times over. A posed fixture may do what a laid-out maze may
// not (`specs/instrumentation.md` exempts one from those rules), so the patrol gets
// a ring of its own with solid rock between it and the forager, and "wandering"
// holds for the whole measurement.
//
// WHAT THIS DOES NOT DECIDE. Whether a chase is faster (`gloamfin/chase-cap`),
// what a corner costs (`gloamfin/corners-slow`), or whether a predator keeps to the
// corridors (`maze-movement/predators-keep-to-corridors`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { PREDATOR_SPEED, TICK_HZ } from "../constants";
import { poseApart, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  parkForager,
  requirePredatorMotion,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import { gloamfinOf, groundBetween } from "./pings";

/**
 * How far the patrol's ring stands from the forager's own room, in tiles, and how
 * much corridor each of them holds.
 *
 * Ten tiles is three hundred and twenty logical units, five times the
 * `GLOAMFIN_HEAR` (`64`) that close hearing reaches — and the rock between them
 * makes the number a comfort rather than the thing that holds the scenario. The
 * ring is a loop, so a patrol has somewhere to go and keeps traveling instead of
 * pacing a dead end.
 */
const APART_TILES = 10;
const RING_TILES = 4;

/**
 * Ticks each measurement runs over, and the ticks of settling before it opens.
 *
 * A whole second of travel, which is `PREDATOR_SPEED` (`116`) logical units on a
 * conforming build — far more ground than any rounding, and comfortably inside the
 * ring. The settle is there because `setPredatorTile` leaves a predator with no
 * heading (`specs/instrumentation.md` moves it and leaves it there), so the first
 * steps after a pose are a patrol getting under way rather than one traveling.
 */
const MEASURE_TICKS = TICK_HZ;
const SETTLE_TICKS = 12;

/**
 * The minute of wandering between the two readings, in ticks.
 *
 * `specs/predators/gloamfin.md` states the claim in exactly this unit — "a
 * Gloamfin that has wandered for a minute" — so the check waits the minute out
 * rather than sampling something shorter and calling it the same question.
 */
const MINUTE_TICKS = 60 * TICK_HZ;

/**
 * How far either reading may sit from `PREDATOR_SPEED`, as a fraction.
 *
 * Two percent, which is the review item's own bound, and `2.32` logical units a
 * second here. It is far tighter than any of the speeds this Gloamfin could be
 * confused with: `GLOAMFIN_CHASE_SPEED` (`134`) is fifteen percent away and
 * `GLOAMFIN_CORNER_SPEED` (`115`) — the one figure inside the band — belongs to a
 * chase, which this scenario never enters and which the check asserts against.
 */
const SPEED_TOLERANCE = 0.02;
const SPEED_SLACK = PREDATOR_SPEED * SPEED_TOLERANCE;

/** Ticks held past the second reading, purely so the clip reads as a patrol. */
const TAIL_TICKS = 60;

/** What one measurement window found. */
interface Wander {
  /** The mean of the `speed` the snapshot reported across the window. */
  reported: number;
  /** Ground covered over the window, turned into logical units a second. */
  covered: number;
  /** The states the Gloamfin was in across the window. */
  states: Set<string>;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Sample the Gloamfin every tick for a window, and report what it did. */
async function measure(index: number): Promise<Wander> {
  let previous = gloamfinOf(h.snapshot(), index);
  let ground = 0;
  let reported = 0;
  const states = new Set<string>();
  for (let tick = 0; tick < MEASURE_TICKS; tick += 1) {
    await h.advance(1);
    const now = gloamfinOf(h.snapshot(), index);
    ground += groundBetween(previous, now);
    reported += now.speed;
    states.add(now.state);
    previous = now;
  }
  return {
    reported: reported / MEASURE_TICKS,
    covered: (ground * TICK_HZ) / MEASURE_TICKS,
    states,
  };
}

it("It wanders at a steady PREDATOR_SPEED", async () => {
  await startPlaying(h);
  const rooms = await poseApart(h, APART_TILES, { ring: RING_TILES });
  const index = await spawnPredator(h, "gloamfin", rooms.far, {
    state: "wander",
  });
  await parkForager(h);
  // The patrol this measures happens across the board in the dark, where the
  // forager's light never falls, so a clip of the canvas alone would be a black
  // screen. `specs/instrumentation.md` puts the current state, tile and speed of
  // every predator on the debug overlay and makes the overlay a READ-ONLY panel
  // toggled by the backtick key, so this leaves the simulation exactly as it was
  // and gives the recording something to show.
  await h.tap("Backquote");
  const guard = await sceneGuard(h);

  const opening = h.snapshot();
  await h.advance(SETTLE_TICKS);
  const early = await measure(index);
  const settled = h.snapshot();
  requirePredatorMotion(
    opening,
    settled,
    index,
    "wander the ring this scenario posed for it",
  );

  // The minute, run before the capture below opens, so the wait costs the clip
  // nothing: a recording holds only the frames the section it wraps drove.
  await h.advance(MINUTE_TICKS);

  const late = await captureReplay(h, "wander", async () => {
    const measured = await measure(index);
    // Past the reading, so the clip runs on for a readable moment. Both windows
    // are already taken, so nothing after this line can change the verdict.
    await h.advance(TAIL_TICKS);
    return measured;
  });

  requireSceneHeld(h.snapshot(), guard);

  for (const [when, window] of [
    ["a moment after it was set loose", early],
    [`after ${MINUTE_TICKS / TICK_HZ} s of wandering`, late],
  ] as const) {
    assertEqual(
      [...window.states].join(","),
      "wander",
      `the Gloamfin's state across the window measured ${when}: this point ` +
        `measures a WANDER, and specs/predators/gloamfin.md gives a chase and a ` +
        `search speeds of their own`,
    );
    assertLessThanOrEqual(
      Math.abs(window.reported - PREDATOR_SPEED),
      SPEED_SLACK,
      `how far the reported speed sat from PREDATOR_SPEED (${PREDATOR_SPEED}) ` +
        `${when}, over ${MEASURE_TICKS} ticks — specs/predators/gloamfin.md has ` +
        `a wandering Gloamfin travel at PREDATOR_SPEED, steady for as long as it ` +
        `wanders`,
    );
    assertLessThanOrEqual(
      Math.abs(window.covered - PREDATOR_SPEED),
      SPEED_SLACK,
      `how far the ground it actually covered ${when} sat from PREDATOR_SPEED ` +
        `(${PREDATOR_SPEED}) logical units a second, over ${MEASURE_TICKS} ticks`,
    );
  }

  // And the two readings agree with each other, which is the "no wind-up" half
  // stated directly rather than inferred from two separate bounds.
  assertLessThanOrEqual(
    Math.abs(late.covered - early.covered),
    SPEED_SLACK,
    `how far the ground covered after a minute of wandering sat from the ground ` +
      `covered a moment after release — specs/predators/gloamfin.md: the wander ` +
      `speed never winds up`,
  );
});
